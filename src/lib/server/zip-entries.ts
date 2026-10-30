import { lstatSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { ZipEntry } from './zip-writer';

/**
 * Every folder and file under `root` as zip entries named relative to it. Symlinks are skipped:
 * following one could pull in files from outside the folder. `skip` gets each entry's
 * relative path and leaves out the entry, and everything beneath a folder, when it says so.
 */
export function listZipEntries(root: string, skip?: (rel: string) => boolean) {
	const entries: ZipEntry[] = [];
	const walk = (dir: string) => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			const entry = lstatSync(path);
			const zipName = relative(root, path).split(sep).join('/');
			if (entry.isSymbolicLink() || skip?.(zipName)) continue;
			if (entry.isDirectory()) {
				entries.push({ kind: 'dir', name: zipName, modified: entry.mtime });
				walk(path);
			} else if (entry.isFile()) {
				entries.push({ kind: 'file', name: zipName, path, modified: entry.mtime });
			}
		}
	};
	walk(root);
	return entries;
}
