// Turns a flat list of paths into folders inside folders, for the file tree component.

export type FileNode<T> = { kind: 'file'; name: string; path: string; item: T };
export type FolderNode<T> = { kind: 'folder'; name: string; path: string; children: TreeNode<T>[] };
export type TreeNode<T> = FileNode<T> | FolderNode<T>;

const byName = <T>(a: TreeNode<T>, b: TreeNode<T>) =>
	Number(b.kind === 'folder') - Number(a.kind === 'folder') ||
	a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

function sorted<T>(nodes: TreeNode<T>[]): TreeNode<T>[] {
	return nodes
		.map((node) => (node.kind === 'folder' ? { ...node, children: sorted(node.children) } : node))
		.toSorted(byName);
}

/**
 * Each item becomes a file node that keeps the item itself. Folders are made from the paths, so
 * only a folder that holds a file exists; they come first, then names in natural order.
 */
export function buildFileTree<T extends { path: string }>(items: T[]): TreeNode<T>[] {
	const root: FolderNode<T> = { kind: 'folder', name: '', path: '', children: [] };
	for (const item of items) {
		const parts = item.path.split('/');
		let folder = root;
		for (const [index, name] of parts.slice(0, -1).entries()) {
			let next = folder.children.find(
				(child): child is FolderNode<T> => child.kind === 'folder' && child.name === name
			);
			if (!next) {
				next = { kind: 'folder', name, path: parts.slice(0, index + 1).join('/'), children: [] };
				folder.children.push(next);
			}
			folder = next;
		}
		folder.children.push({ kind: 'file', name: parts.at(-1)!, path: item.path, item });
	}
	return sorted(root.children);
}
