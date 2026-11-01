// Turns what a user drops or picks into a flat list of files with their path inside it. Browser
// only: plain functions over the File System Entry API, kept apart so they can be tested.

import { BATCH_BYTES, BATCH_FILES } from './upload-limits.js';

export type UploadItem = { file: File; path: string };

type Reader = {
	readEntries: (ok: (entries: FsEntry[]) => void, fail: (e: unknown) => void) => void;
};
export type FsEntry = {
	isFile: boolean;
	isDirectory: boolean;
	name: string;
	fullPath: string;
	file?: (ok: (file: File) => void, fail: (e: unknown) => void) => void;
	createReader?: () => Reader;
};

export const MAX_ITEMS = 5000;

const readFile = (entry: FsEntry) => new Promise<File>((ok, fail) => entry.file!(ok, fail));

/** A directory reader returns its entries in batches (Chrome: 100); call until it is empty. */
async function readAll(reader: Reader) {
	const all: FsEntry[] = [];
	for (;;) {
		const batch = await new Promise<FsEntry[]>((ok, fail) => reader.readEntries(ok, fail));
		if (!batch.length) return all;
		all.push(...batch);
	}
}

/** Walks dropped entries (files and whole folders); the path keeps the dropped folder's name. */
export async function collectEntries(entries: FsEntry[]): Promise<UploadItem[]> {
	const items: UploadItem[] = [];
	const visit = async (entry: FsEntry) => {
		if (items.length > MAX_ITEMS) return;
		if (entry.isFile) {
			items.push({ file: await readFile(entry), path: entry.fullPath.replace(/^\/+/, '') });
		} else if (entry.isDirectory && entry.createReader) {
			for (const child of await readAll(entry.createReader())) await visit(child);
		}
	};
	for (const entry of entries) await visit(entry);
	return items;
}

/** Files from a file input; a folder picker (`webkitdirectory`) sets webkitRelativePath. */
export const fromFileList = (files: Iterable<File>): UploadItem[] =>
	Array.from(files, (file) => ({ file, path: file.webkitRelativePath || file.name }));

/**
 * The files of a drop (loose files, and whole folders when `folders` is on). Call it straight from
 * the drop handler: the entries are taken before the first wait, because the browser empties the
 * list once the handler returns.
 */
export async function readDropped(
	transfer: Pick<DataTransfer, 'items' | 'files'>,
	folders = true
): Promise<UploadItem[]> {
	const entries = Array.from(transfer.items)
		.map((item) => item.webkitGetAsEntry?.())
		.filter((entry): entry is FileSystemEntry => !!entry);
	return folders && entries.length
		? collectEntries(entries as unknown as FsEntry[])
		: fromFileList(transfer.files);
}

/** Splits a queue into requests that each stay well under the server's body limit. */
export function batches(items: UploadItem[], maxBytes = BATCH_BYTES, maxFiles = BATCH_FILES) {
	const out: UploadItem[][] = [];
	let current: UploadItem[] = [];
	let bytes = 0;
	for (const item of items) {
		if (current.length && (bytes + item.file.size > maxBytes || current.length >= maxFiles)) {
			out.push(current);
			current = [];
			bytes = 0;
		}
		current.push(item);
		bytes += item.file.size;
	}
	if (current.length) out.push(current);
	return out;
}
