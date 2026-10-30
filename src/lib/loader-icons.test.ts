import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOADERS } from './loader-list';

describe('loader icons', () => {
	it.each(LOADERS)('there is an icon for %s', (loader) => {
		expect(existsSync(join(import.meta.dirname, 'assets/loaders', `${loader}.png`))).toBe(true);
	});
});

describe('loader colors', () => {
	const css = readFileSync(join(import.meta.dirname, '../routes/layout.css'), 'utf8');

	it.each(LOADERS)(
		'the %s token is declared for light and dark and exposed to Tailwind',
		(loader) => {
			expect(css.match(new RegExp(`--loader-${loader}:`, 'g'))).toHaveLength(2);
			expect(css).toContain(`--color-loader-${loader}: var(--loader-${loader});`);
		}
	);

	it.each(LOADERS)('a badge for %s is tinted by its token', (loader) => {
		expect(css).toContain(`&[data-loader='${loader}']`);
		expect(css).toContain(`color: var(--loader-${loader});`);
	});
});
