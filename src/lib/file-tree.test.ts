import { describe, expect, it } from 'vitest';

import {
	buildFileTree,
	canMoveInto,
	carriedBy,
	decodeDrag,
	encodeDrag,
	intoItself,
	movedPath,
	nodeState,
	toggleNode,
	topLevelPaths
} from './file-tree';

describe('buildFileTree', () => {
	it('nests files in their folders, folders first, then by name', () => {
		const tree = buildFileTree([
			{ path: 'options.txt', size: 1 },
			{ path: 'config/sodium/b.json', size: 2 },
			{ path: 'config/a.toml', size: 3 },
			{ path: 'config/sodium/a.json', size: 4 },
			{ path: 'defaultconfigs/x.toml', size: 5 }
		]);

		expect(tree.map((node) => `${node.kind}:${node.path}`)).toEqual([
			'folder:config',
			'folder:defaultconfigs',
			'file:options.txt'
		]);
		const config = tree[0];
		expect(config.kind === 'folder' && config.children.map((c) => c.path)).toEqual([
			'config/sodium',
			'config/a.toml'
		]);
		const sodium = config.kind === 'folder' ? config.children[0] : undefined;
		expect(sodium?.kind === 'folder' && sodium.children.map((c) => c.name)).toEqual([
			'a.json',
			'b.json'
		]);
	});

	it('keeps each item on its file, with whatever else it carried', () => {
		const [file] = buildFileTree([{ path: 'a/b.txt', size: 7, locked: true }]);
		const inner = file.kind === 'folder' ? file.children[0] : undefined;
		expect(inner?.kind === 'file' && inner.item).toEqual({
			path: 'a/b.txt',
			size: 7,
			locked: true
		});
	});

	it('sorts numbers by value, ignoring case', () => {
		const names = buildFileTree([{ path: 'b10.txt' }, { path: 'B2.txt' }, { path: 'a.txt' }]).map(
			(node) => node.name
		);
		expect(names).toEqual(['a.txt', 'B2.txt', 'b10.txt']);
	});

	it('shows a folder named as empty, with the folders above it, and does not double one that has files', () => {
		const tree = buildFileTree(
			[{ path: 'config/a.toml' }],
			['config', 'config/new/deeper', 'logs']
		);
		expect(tree.map((node) => node.path)).toEqual(['config', 'logs']);
		const config = tree[0];
		expect(config.kind === 'folder' && config.children.map((c) => c.path)).toEqual([
			'config/new',
			'config/a.toml'
		]);
		const inner = config.kind === 'folder' ? config.children[0] : undefined;
		expect(inner?.kind === 'folder' && inner.children.map((c) => c.path)).toEqual([
			'config/new/deeper'
		]);
	});

	it('is empty for no files', () => {
		expect(buildFileTree([])).toEqual([]);
	});
});

describe('movedPath', () => {
	it('puts a file or folder into the folder it is dropped on, keeping its name', () => {
		expect(movedPath('config/a.toml', 'defaults')).toBe('defaults/a.toml');
		expect(movedPath('config/a.toml', 'config/sub')).toBe('config/sub/a.toml');
		expect(movedPath('config/sodium', 'other')).toBe('other/sodium');
	});

	it('moves to the root when dropped there', () => {
		expect(movedPath('config/a.toml', '')).toBe('a.toml');
		expect(movedPath('config/sodium', '')).toBe('sodium');
	});

	it('does nothing when the item is already in that folder, or the root', () => {
		expect(movedPath('config/a.toml', 'config')).toBeNull();
		expect(movedPath('a.toml', '')).toBeNull();
	});

	it('refuses a folder dropped into itself or something inside it, but not a folder that only shares a name prefix', () => {
		expect(movedPath('config', 'config')).toBeNull();
		expect(movedPath('config', 'config/sodium')).toBeNull();
		expect(movedPath('config', 'config2')).toBe('config2/config');
	});
});

describe('selection', () => {
	const tree = buildFileTree([
		{ path: 'config/sodium/a.json' },
		{ path: 'config/b.toml' },
		{ path: 'options.txt' }
	]);
	const config = tree[0];
	const sodium = config.kind === 'folder' ? config.children[0] : undefined;
	const bToml = config.kind === 'folder' ? config.children[1] : undefined;

	it('chooses a folder with everything in it, and clears it the same way', () => {
		const on = toggleNode(new Set(), config, true);
		expect([...on].sort()).toEqual([
			'config',
			'config/b.toml',
			'config/sodium',
			'config/sodium/a.json'
		]);
		expect(toggleNode(on, config, false).size).toBe(0);
	});

	it('takes the folders around a file off when the file is cleared', () => {
		const on = toggleNode(new Set(), config, true);
		const off = toggleNode(on, sodium!.kind === 'folder' ? sodium!.children[0] : sodium!, false);
		// the file's own folders (config and config/sodium) are no longer wholly chosen
		expect([...off]).toEqual(['config/b.toml']);
	});

	it('reads a folder as chosen, mixed or not chosen from its files', () => {
		expect(nodeState(config, new Set())).toBe(false);
		expect(nodeState(config, new Set(['config/b.toml']))).toBe('mixed');
		expect(nodeState(config, new Set(['config/b.toml', 'config/sodium/a.json']))).toBe(true);
		expect(nodeState(bToml!, new Set(['config/b.toml']))).toBe(true);
	});

	it('reads a folder with no files by its own path', () => {
		const empty = buildFileTree([], ['kept'])[0];
		expect(nodeState(empty, new Set())).toBe(false);
		expect(nodeState(empty, new Set(['kept']))).toBe(true);
	});
});

describe('topLevelPaths', () => {
	it('drops what a chosen folder already covers, and repeats', () => {
		expect(
			topLevelPaths(['config', 'config/a.toml', 'config/sodium/b.json', 'options.txt', 'config'])
		).toEqual(['config', 'options.txt']);
		expect(topLevelPaths(['config2', 'config'])).toEqual(['config2', 'config']);
		expect(topLevelPaths([])).toEqual([]);
	});
});

describe('dragging several items', () => {
	it('allows a drop that moves at least one item and puts no folder inside itself', () => {
		expect(canMoveInto(['a.toml', 'config/b.toml'], 'other')).toBe(true);
		// one is already there, the other is not: the drop moves the other
		expect(canMoveInto(['config/a.toml', 'b.toml'], 'config')).toBe(true);
		expect(canMoveInto(['config/a.toml', 'config/b.toml'], 'config')).toBe(false);
		expect(canMoveInto(['config', 'a.toml'], 'config/sodium')).toBe(false);
		expect(canMoveInto(['config', 'a.toml'], 'config')).toBe(false);
		expect(canMoveInto([], 'config')).toBe(false);
	});

	it('knows when a folder would go into itself, but not for a name that only shares a prefix', () => {
		expect(intoItself('config', 'config')).toBe(true);
		expect(intoItself('config', 'config/sodium')).toBe(true);
		expect(intoItself('config', 'config2')).toBe(false);
	});

	it('carries everything chosen when the dragged row is one of several, else the row alone', () => {
		const chosen = new Set(['a.toml', 'config', 'config/b.toml']);
		expect(carriedBy('a.toml', chosen)).toEqual(['a.toml', 'config']);
		// a row that is not chosen drags alone, and so does the only row chosen
		expect(carriedBy('c.toml', chosen)).toEqual(['c.toml']);
		expect(carriedBy('a.toml', new Set(['a.toml']))).toEqual(['a.toml']);
		expect(carriedBy('a.toml', new Set())).toEqual(['a.toml']);
	});

	it('carries the paths as drag data and reads them back, and reads nonsense as none', () => {
		expect(decodeDrag(encodeDrag(['a.toml', 'config/sodium']))).toEqual([
			'a.toml',
			'config/sodium'
		]);
		expect(decodeDrag('not json')).toEqual([]);
		expect(decodeDrag('{"a":1}')).toEqual([]);
		expect(decodeDrag('[1,2]')).toEqual([]);
		expect(decodeDrag(undefined)).toEqual([]);
	});
});
