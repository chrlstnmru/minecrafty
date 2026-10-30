import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOADERS } from './loader-list';
import { loaderColors } from './loader-colors';

describe('loader icons', () => {
	it.each(LOADERS)('there is an icon for %s', (loader) => {
		expect(existsSync(join(import.meta.dirname, 'assets/loaders', `${loader}.png`))).toBe(true);
	});
});

describe('loader colors', () => {
	it.each(LOADERS)('there is a color for %s', (loader) => {
		expect(loaderColors[loader]).toMatch(/^#[0-9a-f]{6}$/i);
	});
});
