import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { instanceDir } from './instances';

/**
 * What a modpack put on the server, so a later version can be compared with it: the SHA-1 of
 * every file the pack lists (path relative to the server folder) and of every config file
 * copied from its overrides. A file whose hash no longer matches was changed by the user.
 */
export type PackManifest = {
	files: Record<string, string>;
	overrides: Record<string, string>;
};

const manifestPath = (instanceId: number) => join(instanceDir(instanceId), 'modpack.json');

export function readManifest(instanceId: number): PackManifest | null {
	const path = manifestPath(instanceId);
	if (!existsSync(path)) return null;
	try {
		const data = JSON.parse(readFileSync(path, 'utf8')) as Partial<PackManifest>;
		return { files: data.files ?? {}, overrides: data.overrides ?? {} };
	} catch {
		return null;
	}
}

export function writeManifest(instanceId: number, manifest: PackManifest) {
	writeFileSync(manifestPath(instanceId), JSON.stringify(manifest, null, 2));
}
