import { error } from '@sveltejs/kit';
import { command, form, query } from '$app/server';
import { backupArgsSchema, backupSettingsSchema, newBackupSchema } from '#lib/schemas/backups.js';
import { idSchema } from '#lib/schemas/common.js';
import { record } from '#lib/server/audit.js';
import * as backups from '#lib/server/backups.js';
import { requirePermission } from '#lib/server/auth.js';
import { userFacing } from '#lib/server/http.js';
import { getInstance } from '#lib/server/instances.js';
import { isRunning } from '#lib/server/files.js';

/** The backups with the settings that govern them, and whether the server runs (restore needs it stopped). */
export const instanceBackups = query(idSchema, async (instanceId) => {
	requirePermission(instanceId, 'backups');
	const inst = getInstance(instanceId);
	if (!inst) error(404, 'Instance not found');
	return {
		backups: backups.listBackups(instanceId),
		settings: { keep: inst.backupKeep, excludes: inst.backupExcludes },
		running: await isRunning(instanceId),
		busy: backups.backupBusy(instanceId)
	};
});

export const createBackup = command(newBackupSchema, async ({ id, note }) => {
	requirePermission(id, 'backups');
	const row = await userFacing(() => backups.createBackup(id, { note: note || undefined }));
	record({
		action: 'backup.create',
		summary: note ? `Made a backup: ${note}` : 'Made a backup',
		instanceId: id
	});
	await instanceBackups(id).refresh();
	return row;
});

export const deleteBackup = command(backupArgsSchema, async ({ id, backupId }) => {
	requirePermission(id, 'backups');
	await userFacing(async () => backups.deleteBackup(id, backupId));
	record({ action: 'backup.delete', summary: 'Deleted a backup', instanceId: id });
	await instanceBackups(id).refresh();
});

export const restoreBackup = command(backupArgsSchema, async ({ id, backupId }) => {
	requirePermission(id, 'backups');
	try {
		await userFacing(() => backups.restoreBackup(id, backupId));
		record({ action: 'backup.restore', summary: 'Restored a backup', instanceId: id });
	} finally {
		await instanceBackups(id).refresh();
	}
});

export const updateBackupSettings = form(backupSettingsSchema, async ({ id, keep, excludes }) => {
	requirePermission(id, 'backups');
	await userFacing(async () =>
		backups.setBackupSettings(id, { backupKeep: keep, backupExcludes: excludes })
	);
	record({ action: 'backup.settings', summary: 'Changed the backup settings', instanceId: id });
	await instanceBackups(id).refresh();
});
