import { describe, expect, it } from 'vitest';

import type { ModrinthVersion } from './modrinth';

import { modTarget, versionChoice } from './mod-target';

describe('modTarget', () => {
	const target = (loader: string) => modTarget({ loader, mcVersion: '1.21.1' });

	it('lets Quilt match Fabric mods, and Purpur match Paper plugins', () => {
		expect(target('quilt')).toMatchObject({ loaders: ['quilt', 'fabric'], plugins: false });
		expect(target('purpur').loaders).toEqual(['purpur', 'paper', 'spigot', 'bukkit']);
		expect(target('purpur').plugins).toBe(true);
	});

	it('keeps the loader and version for messages', () => {
		expect(target('fabric')).toEqual({
			loader: 'fabric',
			loaders: ['fabric'],
			plugins: false,
			mcVersion: '1.21.1'
		});
	});
});

describe('versionChoice', () => {
	it('keeps only what a version picker shows', () => {
		const version = {
			id: 'v1',
			version_number: '1.0',
			version_type: 'beta',
			date_published: '2025-01-01',
			files: []
		} as unknown as ModrinthVersion;
		expect(versionChoice(version)).toEqual({
			id: 'v1',
			versionNumber: '1.0',
			versionType: 'beta',
			publishedAt: '2025-01-01'
		});
	});
});
