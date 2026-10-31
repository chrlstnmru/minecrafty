import { error, json } from '@sveltejs/kit';

import { record } from '#lib/server/audit.js';
import { requirePanel } from '#lib/server/auth.js';
import { assertMayWriteCode } from '#lib/server/host-code.js';
import { getPack, saveOverrides } from '#lib/server/local-packs.js';
import { BATCH_FILES } from '#lib/upload-limits.js';

import type { RequestHandler } from './$types';

const MAX_BYTES = 20 * 1024 * 1024;

// Adds config files to a pack as one revision. `file` and `path` repeat in step: each path is where
// that file goes inside the server folder, its own name included (`config/sodium/options.json`).
export const POST: RequestHandler = async ({ params, request }) => {
	const user = requirePanel('modpacks.write');

	const form = await request.formData();
	const files = form.getAll('file');
	const paths = form.getAll('path').map((path) => String(path).replace(/^\/+/, ''));
	if (!files.length || files.length !== paths.length || !files.every((f) => f instanceof File))
		error(400, 'Choose a file');
	if (files.length > BATCH_FILES) error(400, `Add at most ${BATCH_FILES} files at a time`);
	const tooLarge = (files as File[]).find((file) => file.size > MAX_BYTES);
	if (tooLarge) error(400, `${tooLarge.name} is too large (limit ${MAX_BYTES / 1024 / 1024} MB)`);

	try {
		for (const rel of paths) assertMayWriteCode(user, rel);
		const entries = await Promise.all(
			(files as File[]).map(async (file, index) => ({
				rel: paths[index],
				bytes: new Uint8Array(await file.arrayBuffer())
			}))
		);
		await saveOverrides(Number(params.id), entries);
		const pack = getPack(Number(params.id)).name;
		record({
			action: 'pack.config',
			summary:
				paths.length === 1
					? `Added the config file ${paths[0]} to the modpack ${pack}`
					: `Added ${paths.length} config files to the modpack ${pack}`
		});
		return json({ paths });
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'Could not save the files');
	}
};
