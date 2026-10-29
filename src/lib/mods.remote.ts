import { command, query } from '$app/server';
import { z } from 'zod';
import { requireAdmin } from '#lib/server/auth.js';
import { userFacing } from '#lib/server/http.js';
import { getInstance } from '#lib/server/instances.js';
import * as mods from '#lib/server/mods.js';

const id = z.number().int().positive();

/** What the Mods tab should call itself and whether the loader supports it at all. */
export const modsInfo = query(id, async (instanceId) => {
	requireAdmin();
	const inst = getInstance(instanceId);
	if (!inst) return null;
	const { supported, noun, folder } = mods.modSupport(inst.loader);
	return { supported, noun, folder, loader: inst.loader, mcVersion: inst.mcVersion };
});

export const installedMods = query(id, async (instanceId) => {
	requireAdmin();
	return mods.listInstalled(instanceId);
});

/** Newer releases of the installed mods; one Modrinth request regardless of how many are installed. */
export const modUpdates = query(id, async (instanceId) => {
	requireAdmin();
	return userFacing(() => mods.checkUpdates(instanceId));
});

export const searchMods = query(
	z.object({ id, query: z.string().max(100), limit: z.number().int().min(1).max(100) }),
	async ({ id: instanceId, query, limit }) => {
		requireAdmin();
		return userFacing(() => mods.search(instanceId, query.trim(), limit));
	}
);

const versionId = z.string().min(1).max(64);

/** Versions of a project that run on this instance, for the version picker. */
export const modVersions = query(
	z.object({ id, projectId: z.string().min(1).max(64) }),
	async ({ id: instanceId, projectId }) => {
		requireAdmin();
		return userFacing(() => mods.listModVersions(instanceId, projectId));
	}
);

export const installMod = command(
	z.object({ id, projectId: z.string().min(1).max(64), versionId: versionId.optional() }),
	async ({ id: instanceId, projectId, versionId }) => {
		requireAdmin();
		const result = await userFacing(() => mods.install(instanceId, projectId, versionId));
		await Promise.all([installedMods(instanceId).refresh(), modUpdates(instanceId).refresh()]);
		return result;
	}
);

export const removeMod = command(
	z.object({ id, modId: z.number().int().positive() }),
	async ({ id: instanceId, modId }) => {
		requireAdmin();
		await userFacing(async () => mods.remove(instanceId, modId));
		await Promise.all([installedMods(instanceId).refresh(), modUpdates(instanceId).refresh()]);
	}
);

export const updateMod = command(
	z.object({ id, modId: z.number().int().positive(), versionId: versionId.optional() }),
	async ({ id: instanceId, modId, versionId }) => {
		requireAdmin();
		const result = await userFacing(() => mods.update(instanceId, modId, versionId));
		await Promise.all([installedMods(instanceId).refresh(), modUpdates(instanceId).refresh()]);
		return result;
	}
);
