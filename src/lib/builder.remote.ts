import { command, query } from '$app/server';
import * as v from 'valibot';

import { PACK_LOADERS } from '#lib/pack-loaders.js';
import {
	addPackModSchema,
	installFromPackSchema,
	mcChangeSchema,
	movePackConfigSchema,
	newPackSchema,
	overridePathSchema,
	packArgs,
	packFileArgs,
	packFileVersionSchema,
	packLoaderVersionSchema,
	packProjectArgs,
	packSearchSchema,
	savePackConfigSchema,
	updatePackSchema
} from '#lib/schemas/builder.js';
import { record } from '#lib/server/audit.js';
import { requirePanel } from '#lib/server/auth.js';
import { assertMayWriteCode } from '#lib/server/host-code.js';
import { userFacing } from '#lib/server/http.js';
import { portConflict } from '#lib/server/instances.js';
import { getMinecraftVersions } from '#lib/server/loaders.js';
import * as packs from '#lib/server/local-packs.js';

const packName = (id: number) => packs.getPack(id).name;

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
	record({ action: 'pack.create', summary: `Created the modpack ${input.name}` });
	await listLocalPacks().refresh();
	return { id: pack.id };
});

export const updateLocalPack = command(updatePackSchema, async ({ id, ...change }) => {
	requirePanel('modpacks.write');
	const before = packs.getPack(id);
	await userFacing(async () => packs.updatePack(id, change));
	const renamed = change.name !== undefined && change.name.trim() !== before.name;
	const described =
		change.description !== undefined && change.description.trim() !== before.description;
	if (renamed || described)
		record({
			action: 'pack.change',
			summary: renamed
				? `Renamed the modpack ${before.name} to ${change.name!.trim()}${described ? ' and changed its description' : ''}`
				: `Changed the description of the modpack ${before.name}`
		});
	await Promise.all([getLocalPack({ id }).refresh(), listLocalPacks().refresh()]);
});

export const deleteLocalPack = command(packArgs, async ({ id }) => {
	requirePanel('modpacks.write');
	const name = packs.getPack(id).name;
	await userFacing(async () => packs.deletePack(id));
	record({ action: 'pack.delete', summary: `Deleted the modpack ${name}` });
	await listLocalPacks().refresh();
});

export const duplicateLocalPack = command(packArgs, async ({ id }) => {
	requirePanel('modpacks.write');
	const copy = await userFacing(async () => packs.duplicatePack(id));
	record({ action: 'pack.create', summary: `Copied the modpack ${copy.name}` });
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
	record({
		action: 'pack.mod',
		summary: `Added ${result.added.map((m) => m.title).join(', ')} to the modpack ${packName(id)}`
	});
	await refreshed(id);
	return result;
});

export const removePackFile = command(packFileArgs, async ({ id, fileId }) => {
	requirePanel('modpacks.write');
	const title = packs.listFiles(id).find((f) => f.id === fileId)?.title ?? 'a file';
	await userFacing(async () => packs.removeFile(id, fileId));
	record({ action: 'pack.mod', summary: `Removed ${title} from the modpack ${packName(id)}` });
	await refreshed(id);
});

export const setPackFileVersion = command(
	packFileVersionSchema,
	async ({ id, fileId, versionId }) => {
		requirePanel('modpacks.write');
		await userFacing(() => packs.setModVersion(id, fileId, versionId));
		const file = packs.listFiles(id).find((f) => f.id === fileId);
		record({
			action: 'pack.mod',
			summary: `Moved ${file?.title ?? 'a mod'} to ${file?.versionNumber ?? 'another version'} in the modpack ${packName(id)}`
		});
		await refreshed(id);
	}
);

/** The loader builds on offer for the pack's Minecraft version, newest first. */
export const packLoaderBuilds = query(packArgs, async ({ id }) => {
	requirePanel('modpacks.read');
	return userFacing(() => packs.packLoaderBuilds(id));
});

export const setPackLoaderVersion = command(
	packLoaderVersionSchema,
	async ({ id, loaderVersion }) => {
		requirePanel('modpacks.write');
		const pack = packs.getPack(id);
		await userFacing(() => packs.setLoaderVersion(id, loaderVersion));
		record({
			action: 'pack.version',
			summary: `Set the ${pack.loader} build of the modpack ${pack.name} to ${loaderVersion}`
		});
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
		record({
			action: 'pack.version',
			summary: `Moved the modpack ${packs.getPack(id).name} to Minecraft ${mcVersion}`
		});
		await refreshed(id);
		return result;
	}
);

export const removePackIcon = command(packArgs, async ({ id }) => {
	requirePanel('modpacks.write');
	await userFacing(async () => packs.removeIcon(id));
	record({ action: 'pack.icon', summary: `Removed the icon of the modpack ${packName(id)}` });
	await refreshed(id);
});

export const removePackOverride = command(overridePathSchema, async ({ id, path }) => {
	requirePanel('modpacks.write');
	await userFacing(async () => packs.removeOverride(id, path));
	record({
		action: 'pack.config',
		summary: `Removed the config file ${path} from the modpack ${packName(id)}`
	});
	await refreshed(id);
});

export const readPackConfig = query(overridePathSchema, async ({ id, path }) => {
	requirePanel('modpacks.read');
	return userFacing(async () => packs.readOverrideText(id, path));
});

/** Without `baseHash` the file is new; with it, the save is refused if the file changed meanwhile. */
export const savePackConfig = command(
	savePackConfigSchema,
	async ({ id, path, content, baseHash }) => {
		const user = requirePanel('modpacks.write');
		await userFacing(async () => {
			assertMayWriteCode(user, path);
			await packs.writeOverrideText(id, path, content, baseHash);
		});
		record({
			action: 'pack.config',
			summary: `${baseHash === undefined ? 'Added' : 'Edited'} the config file ${path} ${baseHash === undefined ? 'to' : 'in'} the modpack ${packName(id)}`
		});
		await readPackConfig({ id, path }).refresh();
		await refreshed(id);
	}
);

export const removePackConfigFolder = command(overridePathSchema, async ({ id, path }) => {
	requirePanel('modpacks.write');
	const removed = await userFacing(async () => packs.removeOverrideFolder(id, path));
	record({
		action: 'pack.config',
		summary: `Removed the config folder ${path} (${removed} ${removed === 1 ? 'file' : 'files'}) from the modpack ${packName(id)}`
	});
	await refreshed(id);
});

export const movePackConfigFolder = command(movePackConfigSchema, async ({ id, from, to }) => {
	const user = requirePanel('modpacks.write');
	await userFacing(async () => {
		// a folder move carries its files along, so the owner-only rule holds for each of them
		for (const file of packs.listOverrides(id))
			if (file.path.startsWith(`${from}/`)) assertMayWriteCode(user, file.path);
		packs.moveOverrideFolder(id, from, to);
	});
	record({
		action: 'pack.config',
		summary: `Moved the config folder ${from} to ${to} in the modpack ${packName(id)}`
	});
	await refreshed(id);
});

export const movePackConfig = command(movePackConfigSchema, async ({ id, from, to }) => {
	const user = requirePanel('modpacks.write');
	await userFacing(async () => {
		assertMayWriteCode(user, from);
		assertMayWriteCode(user, to);
		packs.moveOverride(id, from, to);
	});
	record({
		action: 'pack.config',
		summary: `Moved the config file ${from} to ${to} in the modpack ${packName(id)}`
	});
	await refreshed(id);
});

/** Creates an instance from the pack; the install carries on in the background. */
export const installPack = command(installFromPackSchema, async ({ id, ...opts }) => {
	requirePanel('instances.create');
	requirePanel('modpacks.read');
	return userFacing(async () => {
		try {
			const row = await packs.startInstall(id, opts);
			record({
				action: 'instance.create',
				summary: `Created the server from the modpack ${packs.getPack(id).name}`,
				instanceId: row.id
			});
			return { id: row.id };
		} catch (e) {
			const port = portConflict(e);
			throw port ? new Error(port) : e;
		}
	});
});
