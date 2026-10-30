import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = new URL('.', import.meta.url);
const remotes = readdirSync(dir).filter((f) => f.endsWith('.remote.ts') && f !== 'auth.remote.ts');

// each export must open with a guard, so a new remote function cannot be added unprotected
describe('remote functions', () => {
	for (const file of remotes) {
		it(`${file} checks who is calling in every export`, () => {
			const source = readFileSync(new URL(file, dir), 'utf8');
			const parts = source.split(/^export const /m).slice(1);
			expect(parts.length).toBeGreaterThan(0);
			for (const part of parts) {
				const name = part.split(/\s/)[0];
				expect(part, name).toMatch(/require(Admin|User|Panel|Permission)\(/);
			}
		});
	}
});
