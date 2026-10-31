import { error } from '@sveltejs/kit';

import { requirePanel } from '#lib/server/auth.js';
import { exportOverridesZip } from '#lib/server/local-packs.js';
import { zipStream } from '#lib/server/zip-writer.js';

import type { RequestHandler } from './$types';

// A POST, not a GET: a long list of paths would not fit in a URL. The page sends the form and saves
// the answer as a file.
export const POST: RequestHandler = async ({ params, request }) => {
	requirePanel('modpacks.read');

	const paths = (await request.formData()).getAll('path').map(String);
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
