import { error } from '@sveltejs/kit';
import { manualPackFile } from '#lib/server/packs.js';
import type { RequestHandler } from './$types';

// Public on purpose: Minecraft clients download the server resource pack from here when they join.
// Only the instance's current uploaded pack is served, and only under its own sha1.
export const GET: RequestHandler = async ({ params }) => {
	const match = /^([0-9a-f]{40})\.zip$/.exec(params.file);
	if (!match) error(404, 'Not found');

	const path = manualPackFile(params.id, match[1]);
	const file = path ? Bun.file(path) : null;
	if (!file || !(await file.exists())) error(404, 'Not found');

	return new Response(file, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Length': String(file.size),
			// the URL contains the content hash, so it can be cached for good
			'Cache-Control': 'public, max-age=31536000, immutable'
		}
	});
};
