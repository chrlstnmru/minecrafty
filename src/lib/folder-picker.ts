// The pure parts of the folder picker the Move dialogs share: which folders a folder holds, which
// cannot take a move, and whether a name for a new folder is fine.

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The folder that holds `path`; '' is the top, which holds the folders with no slash. */
export const parentFolder = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0));

export const folderName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** Whether `path` is one of `moved` or inside one: a folder that cannot take them. */
export const insideAny = (path: string, moved: string[]) =>
	moved.some((from) => path === from || path.startsWith(`${from}/`));

/** The folders directly inside `folder`, out of every folder path there is, in name order. */
export const childFolders = (all: Iterable<string>, folder: string) =>
	[...new Set(all)]
		.filter((path) => path !== '' && parentFolder(path) === folder)
		.sort((a, b) => collator.compare(folderName(a), folderName(b)));

/** Names in the order the picker lists them. */
export const sortFolders = (paths: string[]) =>
	[...paths].sort((a, b) => collator.compare(folderName(a), folderName(b)));

/** `folder`, or the nearest folder above it that is not excluded (the top is never excluded). */
export function openableFolder(folder: string, excluded: (path: string) => boolean) {
	let current = folder;
	while (current && excluded(current)) current = parentFolder(current);
	return current;
}

/** Why `name` cannot be a new folder next to the folders named `siblings`, or undefined when it can. */
export function newFolderError(name: string, siblings: string[]) {
	const trimmed = name.trim();
	if (!trimmed) return 'Enter a folder name, such as sodium';
	if (/[\\/]/.test(trimmed) || trimmed === '.' || trimmed === '..')
		return 'Use a name without slashes. Open the folder first to choose where it goes.';
	if (siblings.includes(trimmed)) return `${trimmed} already exists here`;
	return undefined;
}
