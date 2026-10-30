import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOADERS } from './loader-list';

describe('loader icons', () => {
	it.each(LOADERS)('there is an icon for %s', (loader) => {
		expect(existsSync(join(import.meta.dirname, 'assets/loaders', `${loader}.png`))).toBe(true);
	});
});
