import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { zipStream, type ZipEntry } from '#lib/server/zip-writer.js';

/** The bytes of a zip holding these files, by their name in the zip. */
export async function zipOf(files: Record<string, string>) {
	const work = mkdtempSync(join(tmpdir(), 'zip-'));
	const entries: ZipEntry[] = Object.entries(files).map(([name, content], i) => {
		const path = join(work, String(i));
		writeFileSync(path, content);
		return { kind: 'file', name, path, modified: new Date() };
	});
	return new Uint8Array(await new Response(zipStream(entries)).arrayBuffer());
}
