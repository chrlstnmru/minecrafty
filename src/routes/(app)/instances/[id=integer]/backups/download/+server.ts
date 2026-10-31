import { error } from '@sveltejs/kit';
import { record } from '#lib/server/audit.js';
import { requirePermission } from '#lib/server/auth.js';
import { existsSync } from 'node:fs';
import { backupPath, getBackup } from '#lib/server/backups.js';
import type { RequestHandler } from './$types';

// A real download needs a plain GET the browser can follow, which a remote function is not.
export const GET: RequestHandler = ({ params, url }) => {
	requirePermission(Number(params.id), 'backups');

	const row = getBackup(params.id, Number(url.searchParams.get('backup')));
	if (!row || !existsSync(backupPath(params.id, row.file))) error(404, 'Backup not found');

	record({
		action: 'backup.download',
		summary: `Downloaded the backup ${row.file}`,
		instanceId: Number(params.id)
	});
	return new Response(Bun.file(backupPath(params.id, row.file)), {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.file)}`
		}
	});
};
