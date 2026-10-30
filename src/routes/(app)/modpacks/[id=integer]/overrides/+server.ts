import { error, json } from '@sveltejs/kit';
import { can } from '#lib/server/access.js';
import { record } from '#lib/server/audit.js';
import { getPack, saveOverride } from '#lib/server/local-packs.js';
import type { RequestHandler } from './$types';

const MAX_BYTES = 20 * 1024 * 1024;

// Adds one config file to a pack, at `path` (a folder inside the server, such as `config`), under
// the uploaded file's own name unless `name` says otherwise.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not signed in');
	if (!can(locals.user, 'modpacks.write')) error(403, 'You do not have permission to do that');

	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) error(400, 'Choose a file');
	if (file.size > MAX_BYTES)
		error(400, `The file is too large (limit ${MAX_BYTES / 1024 / 1024} MB)`);
	const folder = String(form.get('path') ?? '').replace(/^\/+|\/+$/g, '');
	const rel = folder ? `${folder}/${file.name}` : file.name;

	try {
		await saveOverride(Number(params.id), rel, new Uint8Array(await file.arrayBuffer()));
		record({
			action: 'pack.config',
			summary: `Added the config file ${rel} to the modpack ${getPack(Number(params.id)).name}`
		});
		return json({ path: rel });
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'Could not save the file');
	}
};
