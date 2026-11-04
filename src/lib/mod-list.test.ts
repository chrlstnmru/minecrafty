import { describe, expect, it } from 'vitest';

import { countByFilter, filterMods, reason, sideTags, type ModListItem } from './mod-list';

const mod = (over: Partial<ModListItem>): ModListItem => ({
	id: 1,
	projectId: 'P',
	title: 'Mod',
	iconUrl: null,
	file: 'mods/mod.jar',
	versionNumber: '1.0',
	versionId: 'V',
	dependencyOf: null,
	clientSide: 'optional',
	serverSide: 'required',
	enabled: true,
	fromModrinth: true,
	...over
});

describe('sideTags', () => {
	it('says nothing until both sides are known', () => {
		expect(sideTags(null, 'required')).toEqual([]);
		expect(sideTags('required', null)).toEqual([]);
	});

	it('tags each side the mod runs on, required or optional alike', () => {
		expect(sideTags('required', 'unsupported')).toEqual(['client']);
		expect(sideTags('unsupported', 'optional')).toEqual(['server']);
		expect(sideTags('optional', 'required')).toEqual(['server', 'client']);
	});
});

describe('filterMods', () => {
	const items = [
		mod({ id: 1, title: 'Create', file: 'mods/create-6.0.jar', update: { versionNumber: '6.1' } }),
		mod({ id: 2, title: 'Create Deco', enabled: false }),
		mod({ id: 3, title: 'Controlling', serverSide: 'unsupported' })
	];

	it('matches every word of the query against the title or the file', () => {
		expect(filterMods(items, 'all', 'create').map((m) => m.id)).toEqual([1, 2]);
		expect(filterMods(items, 'all', 'CREATE deco').map((m) => m.id)).toEqual([2]);
		expect(filterMods(items, 'all', '6.0.jar').map((m) => m.id)).toEqual([1]);
		expect(filterMods(items, 'all', '  ')).toHaveLength(3);
	});

	it('narrows to the chosen filter', () => {
		expect(filterMods(items, 'updates', '').map((m) => m.id)).toEqual([1]);
		expect(filterMods(items, 'disabled', '').map((m) => m.id)).toEqual([2]);
		expect(filterMods(items, 'client-only', 'create')).toEqual([]);
	});

	it('counts each filter', () => {
		expect(countByFilter(items)).toEqual({ all: 3, updates: 1, disabled: 1, 'client-only': 1 });
	});
});

describe('reason', () => {
	const titles = new Map([['CREATE', 'Create']]);

	it('names the mod that needed it', () => {
		expect(reason(mod({ dependencyOf: 'CREATE' }), titles)).toBe('Required by Create');
		expect(reason(mod({ dependencyOf: 'GONE' }), titles)).toBe('Added as a dependency');
	});

	it('marks files Modrinth does not know, and is quiet otherwise', () => {
		expect(reason(mod({ fromModrinth: false }), titles)).toBe('Not from Modrinth');
		expect(reason(mod({}), titles)).toBeNull();
	});
});
