import { error } from '@sveltejs/kit';

import { requirePanel } from '#lib/server/auth.js';
import { exportOverridesZip } from '#lib/server/local-packs.js';
import { zipStream } from '#lib/server/zip-writer.js';

import type { RequestHandler } from './$types';

// A real download needs a plain GET the browser can follow, which a remote function is not.
export const GET: RequestHandler = ({ params, url }) => {
	requirePanel('modpacks.read');

	const paths = url.searchParams.getAll('path');
	if (paths.length > 500) error(400, 'Choose fewer files and folders');
	let built;
	try {
		built = exportOverridesZip(Number(params.id), paths);
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'Could not make the zip');
	}
	return new Response(zipStream(built.entries), {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(built.filename)}`
		}
	});
};
