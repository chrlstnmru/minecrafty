import { error } from '@sveltejs/kit';

import { record } from '#lib/server/audit.js';
import { requirePermission } from '#lib/server/auth.js';
import { describeDownload, describeSelection } from '#lib/server/files.js';
import { zipStream } from '#lib/server/zip-writer.js';

import type { RequestHandler } from './$types';

// A real download needs a plain GET the browser can follow, which a remote function is not.
export const GET: RequestHandler = ({ params, url }) => {
	requirePermission(Number(params.id), 'files');

	let target;
	try {
		target = describeDownload(params.id, url.searchParams.get('path') ?? '');
	} catch (e) {
		error(404, e instanceof Error ? e.message : 'Not found');
	}

	record({
		action: 'file.download',
		summary: `Downloaded ${target.name}`,
		instanceId: Number(params.id)
	});
	const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(target.name)}`;
	if (target.kind === 'file')
		return new Response(Bun.file(target.path), {
			headers: { 'Content-Disposition': disposition }
		});
	return new Response(zipStream(target.entries), {
		headers: { 'Content-Type': 'application/zip', 'Content-Disposition': disposition }
	});
};

// A POST, not a GET: a long list of paths would not fit in a URL. The page sends the form and saves
// the answer as a file.
export const POST: RequestHandler = async ({ params, request }) => {
	requirePermission(Number(params.id), 'files');

	const paths = (await request.formData()).getAll('path').map(String);
	if (paths.length > 500) error(400, 'Choose fewer files and folders');
	let target;
	try {
		target = describeSelection(params.id, paths);
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'Could not make the zip');
	}

	record({
		action: 'file.download',
		summary: `Downloaded ${paths.length} ${paths.length === 1 ? 'item' : 'items'} as a zip`,
		instanceId: Number(params.id)
	});
	return new Response(zipStream(target.entries), {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(target.name)}`
		}
	});
};
