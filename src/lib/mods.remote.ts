import { command, query } from '$app/server';
import * as v from 'valibot';

import {
	idSchema,
	projectIdSchema,
	searchArgsSchema,
	versionIdSchema
} from '#lib/schemas/common.js';
import { record } from '#lib/server/audit.js';
import { requirePermission } from '#lib/server/auth.js';
import { userFacing } from '#lib/server/http.js';
import * as mods from '#lib/server/mods.js';

const id = idSchema;

const titleOf = (instanceId: number, modId: number) =>
	mods.listInstalled(instanceId).find((m) => m.id === modId)?.title ?? 'a mod';

export const installedMods = query(id, async (instanceId) => {
	requirePermission(instanceId, 'mods');
	return mods.listInstalled(instanceId);
});

/** Newer releases of the installed mods; one Modrinth request regardless of how many are installed. */
export const modUpdates = query(id, async (instanceId) => {
	requirePermission(instanceId, 'mods');
	return userFacing(() => mods.checkUpdates(instanceId));
});

export const searchMods = query(searchArgsSchema, async ({ id: instanceId, query, limit }) => {
	requirePermission(instanceId, 'mods');
	return userFacing(() => mods.search(instanceId, query.trim(), limit));
});

/** Versions of a project that run on this instance, for the version picker. */
export const modVersions = query(
	v.object({ id, projectId: projectIdSchema }),
	async ({ id: instanceId, projectId }) => {
		requirePermission(instanceId, 'mods');
		return userFacing(() => mods.listModVersions(instanceId, projectId));
	}
);

export const installMod = command(
	v.object({ id, projectId: projectIdSchema, versionId: versionIdSchema }),
	async ({ id: instanceId, projectId, versionId }) => {
		requirePermission(instanceId, 'mods');
		const result = await userFacing(() => mods.install(instanceId, projectId, versionId));
		record({
			action: 'mod.install',
			summary: `Installed ${result.installed.map((m) => `${m.title} ${m.version}`).join(', ')}`,
			instanceId
		});
		await Promise.all([installedMods(instanceId).refresh(), modUpdates(instanceId).refresh()]);
		return result;
	}
);

export const removeMod = command(
	v.object({ id, modId: idSchema }),
	async ({ id: instanceId, modId }) => {
		requirePermission(instanceId, 'mods');
		const title = titleOf(instanceId, modId);
		await userFacing(async () => mods.remove(instanceId, modId));
		record({ action: 'mod.remove', summary: `Removed ${title}`, instanceId });
		await Promise.all([installedMods(instanceId).refresh(), modUpdates(instanceId).refresh()]);
	}
);

export const setModEnabled = command(
	v.object({ id, modId: idSchema, enabled: v.boolean() }),
	async ({ id: instanceId, modId, enabled }) => {
		requirePermission(instanceId, 'mods');
		await userFacing(async () => mods.setEnabled(instanceId, modId, enabled));
		record({
			action: 'mod.toggle',
			summary: `${enabled ? 'Enabled' : 'Disabled'} ${titleOf(instanceId, modId)}`,
			instanceId
		});
		await installedMods(instanceId).refresh();
	}
);

export const updateMod = command(
	v.object({ id, modId: idSchema, versionId: versionIdSchema }),
	async ({ id: instanceId, modId, versionId }) => {
		requirePermission(instanceId, 'mods');
		const title = titleOf(instanceId, modId);
		const result = await userFacing(() => mods.update(instanceId, modId, versionId));
		record({ action: 'mod.update', summary: `Updated ${title}`, instanceId });
		await Promise.all([installedMods(instanceId).refresh(), modUpdates(instanceId).refresh()]);
		return result;
	}
);

/** Records where each installed mod runs, for mods installed before that was kept. */
export const refreshModSides = command(id, async (instanceId) => {
	requirePermission(instanceId, 'mods');
	const filled = await userFacing(() => mods.backfillSides(instanceId));
	if (filled) await installedMods(instanceId).refresh();
	return filled;
});

/** Disables every mod that does not run on a server; they stay installed and can be enabled again. */
export const disableClientOnlyMods = command(id, async (instanceId) => {
	requirePermission(instanceId, 'mods');
	const titles = await userFacing(async () => mods.disableClientOnly(instanceId));
	if (titles.length)
		record({
			action: 'mod.toggle',
			summary: `Disabled ${titles.length} client-only ${titles.length === 1 ? 'mod' : 'mods'}`,
			instanceId
		});
	await installedMods(instanceId).refresh();
	return titles;
});
