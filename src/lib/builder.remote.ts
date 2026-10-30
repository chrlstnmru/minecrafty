import { command, query } from '$app/server';
import * as v from 'valibot';
import {
	addPackModSchema,
	installFromPackSchema,
	mcChangeSchema,
	newPackSchema,
	overridePathSchema,
	packArgs,
	packFileArgs,
	packFileVersionSchema,
	packProjectArgs,
	packSearchSchema,
	updatePackSchema
} from '#lib/schemas/builder.js';
import { PACK_LOADERS } from '#lib/pack-loaders.js';
import { requirePanel } from '#lib/server/auth.js';
import { userFacing } from '#lib/server/http.js';
import * as packs from '#lib/server/local-packs.js';
import { getMinecraftVersions } from '#lib/server/loaders.js';

export const listLocalPacks = query(async () => {
	requirePanel('modpacks.read');
	return packs.listPacks();
});

export const getLocalPack = query(packArgs, async ({ id }) => {
	requirePanel('modpacks.read');
	return userFacing(async () => packs.getPack(id));
});

/** Minecraft versions a pack with this loader can use, newest first. */
export const packMinecraftVersions = query(v.picklist(PACK_LOADERS), async (loader) => {
	requirePanel('modpacks.read');
	return userFacing(() => getMinecraftVersions(loader));
});

export const createLocalPack = command(newPackSchema, async (input) => {
	requirePanel('modpacks.write');
	const pack = await userFacing(() => packs.createPack(input));
	await listLocalPacks().refresh();
	return { id: pack.id };
});

export const updateLocalPack = command(updatePackSchema, async ({ id, ...change }) => {
	requirePanel('modpacks.write');
	await userFacing(async () => packs.updatePack(id, change));
	await Promise.all([getLocalPack({ id }).refresh(), listLocalPacks().refresh()]);
});

export const deleteLocalPack = command(packArgs, async ({ id }) => {
	requirePanel('modpacks.write');
	await userFacing(async () => packs.deletePack(id));
	await listLocalPacks().refresh();
});

export const duplicateLocalPack = command(packArgs, async ({ id }) => {
	requirePanel('modpacks.write');
	const copy = await userFacing(async () => packs.duplicatePack(id));
	await listLocalPacks().refresh();
	return { id: copy.id };
});

export const searchPackMods = query(packSearchSchema, async ({ id, query: text, limit }) => {
	requirePanel('modpacks.read');
	return userFacing(() => packs.searchMods(id, text, limit));
});

export const packModVersions = query(packProjectArgs, async ({ id, projectId }) => {
	requirePanel('modpacks.read');
	return userFacing(() => packs.listModVersions(id, projectId));
});

const refreshed = async (id: number) =>
	Promise.all([getLocalPack({ id }).refresh(), listLocalPacks().refresh()]);

export const addPackMod = command(addPackModSchema, async ({ id, projectId, versionId }) => {
	requirePanel('modpacks.write');
	const result = await userFacing(() => packs.addMod(id, projectId, versionId));
	await refreshed(id);
	return result;
});

export const removePackFile = command(packFileArgs, async ({ id, fileId }) => {
	requirePanel('modpacks.write');
	await userFacing(async () => packs.removeFile(id, fileId));
	await refreshed(id);
});

export const setPackFileVersion = command(
	packFileVersionSchema,
	async ({ id, fileId, versionId }) => {
		requirePanel('modpacks.write');
		await userFacing(() => packs.setModVersion(id, fileId, versionId));
		await refreshed(id);
	}
);

export const previewPackVersionChange = query(
	v.object({ id: packArgs.entries.id, mcVersion: mcChangeSchema.entries.mcVersion }),
	async ({ id, mcVersion }) => {
		requirePanel('modpacks.read');
		return userFacing(() => packs.previewVersionChange(id, mcVersion));
	}
);

export const applyPackVersionChange = command(
	mcChangeSchema,
	async ({ id, mcVersion, dropIncompatible }) => {
		requirePanel('modpacks.write');
		const result = await userFacing(() =>
			packs.applyVersionChange(id, mcVersion, dropIncompatible)
		);
		await refreshed(id);
		return result;
	}
);

export const removePackOverride = command(overridePathSchema, async ({ id, path }) => {
	requirePanel('modpacks.write');
	await userFacing(async () => packs.removeOverride(id, path));
	await refreshed(id);
});

/** Creates an instance from the pack; the install carries on in the background. */
export const installPack = command(installFromPackSchema, async ({ id, ...opts }) => {
	requirePanel('instances.create');
	requirePanel('modpacks.read');
	return userFacing(async () => {
		try {
			const row = await packs.startInstall(id, opts);
			return { id: row.id };
		} catch (e) {
			if (String(e).includes('UNIQUE')) throw new Error('Port is already used by another instance');
			throw e;
		}
	});
});
