import { describe, expect, it } from 'vitest';
import { modSupport } from './mods';

describe('modSupport', () => {
	it('knows which loaders run mods', () => {
		for (const loader of ['fabric', 'quilt', 'forge', 'neoforge', 'paper', 'purpur'])
			expect(modSupport(loader).supported).toBe(true);
		expect(modSupport('vanilla').supported).toBe(false);
		expect(modSupport('vanilla').loaders).toEqual([]);
	});

	it('lets Quilt run Fabric mods and Purpur run Paper-family plugins', () => {
		expect(modSupport('quilt').loaders).toEqual(['quilt', 'fabric']);
		expect(modSupport('purpur').loaders).toEqual(['purpur', 'paper', 'spigot', 'bukkit']);
		expect(modSupport('fabric').loaders).toEqual(['fabric']);
	});

	it('calls Paper-family jars plugins and puts them in plugins/', () => {
		expect(modSupport('paper')).toMatchObject({ noun: 'plugin', folder: 'plugins' });
		expect(modSupport('purpur')).toMatchObject({ noun: 'plugin', folder: 'plugins' });
		expect(modSupport('forge')).toMatchObject({ noun: 'mod', folder: 'mods' });
	});
});
