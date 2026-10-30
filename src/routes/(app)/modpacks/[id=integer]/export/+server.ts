import { error } from '@sveltejs/kit';
import { can } from '#lib/server/access.js';
import { exportEntries } from '#lib/server/local-packs.js';
import { zipStream } from '#lib/server/zip-writer.js';
import type { RequestHandler } from './$types';

// A real download needs a plain GET the browser can follow, which a remote function is not.
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Not signed in');
	if (!can(locals.user, 'modpacks.read')) error(403, 'You do not have permission to do that');

	let built;
	try {
		built = await exportEntries(Number(params.id));
	} catch (e) {
		error(404, e instanceof Error ? e.message : 'Pack not found');
	}
	return new Response(zipStream(built.entries), {
		headers: {
			'Content-Type': 'application/x-modrinth-modpack+zip',
			'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(built.filename)}`
		}
	});
};
