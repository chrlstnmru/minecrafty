import { error, json } from '@sveltejs/kit';

import { record } from '#lib/server/audit.js';
import { requirePanel } from '#lib/server/auth.js';
import { importMrpack } from '#lib/server/local-packs.js';

import type { RequestHandler } from './$types';

// A pack of the builder's own size: the server accepts bodies up to 64 MB.
const MAX_BYTES = 60 * 1024 * 1024;

// Takes a Modrinth .mrpack as a multipart upload and makes it a pack; a remote function cannot
// carry a file this large.
export const POST: RequestHandler = async ({ request }) => {
	const user = requirePanel('modpacks.write');

	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof Blob)) error(400, 'Choose a .mrpack file');
	if (file.size > MAX_BYTES)
		error(400, `The pack is too large (limit ${MAX_BYTES / 1024 / 1024} MB)`);
	const name = form.get('name');

	try {
		const pack = await importMrpack(
			new Uint8Array(await file.arrayBuffer()),
			typeof name === 'string' && name.trim() ? name : undefined,
			{ vettedOnly: user.role !== 'owner' }
		);
		record({ action: 'pack.create', summary: `Imported the modpack ${pack.name}` });
		return json({ id: pack.id });
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'Could not import the pack');
	}
};
