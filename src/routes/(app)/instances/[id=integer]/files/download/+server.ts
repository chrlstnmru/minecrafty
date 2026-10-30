import { error } from '@sveltejs/kit';
import { check } from '#lib/server/access.js';
import { describeDownload } from '#lib/server/files.js';
import { zipStream } from '#lib/server/zip-writer.js';
import type { RequestHandler } from './$types';

// A real download needs a plain GET the browser can follow, which a remote function is not.
export const GET: RequestHandler = ({ params, url, locals }) => {
	if (!locals.user) error(401, 'Not signed in');
	const allowed = check(locals.user, Number(params.id), 'files');
	if (allowed === 'unknown') error(404, 'Instance not found');
	if (allowed === 'denied') error(403, 'You do not have permission to do that');

	let target;
	try {
		target = describeDownload(params.id, url.searchParams.get('path') ?? '');
	} catch (e) {
		error(404, e instanceof Error ? e.message : 'Not found');
	}

	const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(target.name)}`;
	if (target.kind === 'file')
		return new Response(Bun.file(target.path), {
			headers: { 'Content-Disposition': disposition }
		});
	return new Response(zipStream(target.entries), {
		headers: { 'Content-Type': 'application/zip', 'Content-Disposition': disposition }
	});
};
