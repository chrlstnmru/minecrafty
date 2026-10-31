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
 * a folder exists only if it holds a file, unless it is named in `emptyFolders`. Folders come
 * first, then names in natural order.
 */
export function buildFileTree<T extends { path: string }>(
	items: T[],
	emptyFolders: string[] = []
): TreeNode<T>[] {
	const root: FolderNode<T> = { kind: 'folder', name: '', path: '', children: [] };
	const folderAt = (parts: string[]) => {
		let folder = root;
		for (const [index, name] of parts.entries()) {
			let next = folder.children.find(
				(child): child is FolderNode<T> => child.kind === 'folder' && child.name === name
			);
			if (!next) {
				next = { kind: 'folder', name, path: parts.slice(0, index + 1).join('/'), children: [] };
				folder.children.push(next);
			}
			folder = next;
		}
		return folder;
	};
	for (const item of items) {
		const parts = item.path.split('/');
		folderAt(parts.slice(0, -1)).children.push({
			kind: 'file',
			name: parts.at(-1)!,
			path: item.path,
			item
		});
	}
	for (const path of emptyFolders) folderAt(path.split('/'));
	return sorted(root.children);
}

/** What a dragged tree item carries, so a drop can tell it from files dragged in from the desktop. */
export const TREE_DRAG_TYPE = 'application/x-minecrafty-tree-item';

/**
 * Where a file or folder ends up when dropped on `folder` ('' is the root), or null when the drop
 * does nothing: it is already there, or a folder would go into itself.
 */
export function movedPath(from: string, folder: string): string | null {
	const to = folder
		? `${folder}/${from.slice(from.lastIndexOf('/') + 1)}`
		: from.slice(from.lastIndexOf('/') + 1);
	if (to === from) return null;
	if (folder === from || folder.startsWith(`${from}/`)) return null;
	return to;
}
