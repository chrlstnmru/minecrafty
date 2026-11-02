import { readdirSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = new URL('.', import.meta.url);
const remotes = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter(
	(f) => f.endsWith('.remote.ts') && basename(f) !== 'auth.remote.ts'
);

// each export must open with a guard, so a new remote function cannot be added unprotected
describe('remote functions', () => {
	it('finds the remote files in subfolders too', () => {
		expect(remotes).toContain('modpacks/builder.remote.ts');
	});

	for (const file of remotes) {
		it(`${file} checks who is calling in every export`, () => {
			const source = readFileSync(new URL(file, dir), 'utf8');
			const parts = source.split(/^export const /m).slice(1);
			expect(parts.length).toBeGreaterThan(0);
			for (const part of parts) {
				const name = part.split(/\s/)[0];
				expect(part, name).toMatch(/require(Admin|Owner|User|Panel|Permission|Instance)\(/);
			}
		});
	}
});
