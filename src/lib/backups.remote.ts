import { error } from '@sveltejs/kit';
import { command, form, query } from '$app/server';
import { backupArgsSchema, backupSettingsSchema, newBackupSchema } from '#lib/schemas/backups.js';
import { idSchema } from '#lib/schemas/common.js';
import * as backups from '#lib/server/backups.js';
import { requireAdmin } from '#lib/server/auth.js';
import { userFacing } from '#lib/server/http.js';
import { getInstance } from '#lib/server/instances.js';
import { isRunning } from '#lib/server/files.js';

/** The backups with the settings that govern them, and whether the server runs (restore needs it stopped). */
export const instanceBackups = query(idSchema, async (instanceId) => {
	requireAdmin();
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
	requireAdmin();
	const row = await userFacing(() => backups.createBackup(id, { note: note || undefined }));
	await instanceBackups(id).refresh();
	return row;
});

export const deleteBackup = command(backupArgsSchema, async ({ id, backupId }) => {
	requireAdmin();
	await userFacing(async () => backups.deleteBackup(id, backupId));
	await instanceBackups(id).refresh();
});

export const restoreBackup = command(backupArgsSchema, async ({ id, backupId }) => {
	requireAdmin();
	try {
		await userFacing(() => backups.restoreBackup(id, backupId));
	} finally {
		await instanceBackups(id).refresh();
	}
});

export const updateBackupSettings = form(backupSettingsSchema, async ({ id, keep, excludes }) => {
	requireAdmin();
	await userFacing(async () =>
		backups.setBackupSettings(id, { backupKeep: keep, backupExcludes: excludes })
	);
	await instanceBackups(id).refresh();
});
