import { describe, expect, it } from 'vitest';

import { buildFileTree } from './file-tree';

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
