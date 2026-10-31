import { error } from '@sveltejs/kit';
import { requirePanel } from '#lib/server/auth.js';
import { exportEntries } from '#lib/server/local-packs.js';
import { zipStream } from '#lib/server/zip-writer.js';
import type { RequestHandler } from './$types';

// A real download needs a plain GET the browser can follow, which a remote function is not.
export const GET: RequestHandler = async ({ params }) => {
	requirePanel('modpacks.read');

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
