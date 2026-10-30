import { error, json } from '@sveltejs/kit';
import { can } from '#lib/server/access.js';
import { record } from '#lib/server/audit.js';
import { getPack, iconFile, saveIcon } from '#lib/server/local-packs.js';
import type { RequestHandler } from './$types';

// An icon is a picture, so anyone signed in may load it: it is also the icon of the servers made
// from the pack. The address carries the file's time, so a changed icon is a new address.
export const GET: RequestHandler = ({ params, locals }) => {
	if (!locals.user) error(401, 'Not signed in');
	const icon = iconFile(Number(params.id));
	if (!icon) error(404, 'No icon');
	return new Response(Bun.file(icon.path), {
		headers: { 'Content-Type': icon.type, 'Cache-Control': 'private, max-age=31536000, immutable' }
	});
};

const MAX_BYTES = 2 * 1024 * 1024;

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not signed in');
	if (!can(locals.user, 'modpacks.write')) error(403, 'You do not have permission to do that');
	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof Blob)) error(400, 'Choose an image');
	if (file.size > MAX_BYTES) error(400, 'The image is too large (limit 2 MB)');
	try {
		await saveIcon(Number(params.id), new Uint8Array(await file.arrayBuffer()));
		record({
			action: 'pack.icon',
			summary: `Changed the icon of the modpack ${getPack(Number(params.id)).name}`
		});
		return json({ ok: true });
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'Could not save the image');
	}
};
