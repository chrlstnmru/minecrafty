import { command, form, query } from '$app/server';
import * as v from 'valibot';
import { requirePermission } from '#lib/server/auth.js';
import { userFacing } from '#lib/server/http.js';
import {
	idSchema,
	projectIdSchema,
	searchArgsSchema,
	versionIdSchema
} from '#lib/schemas/common.js';
import { packOptionsSchema } from '#lib/schemas/packs.js';
import * as packs from '#lib/server/packs.js';

const id = idSchema;
const projectId = projectIdSchema;
const versionId = versionIdSchema;

export const searchPacks = query(searchArgsSchema, async ({ id: instanceId, query, limit }) => {
	requirePermission(instanceId, 'mods');
	return userFacing(() => packs.search(instanceId, query.trim(), limit));
});

export const packVersions = query(
	v.object({ id, projectId }),
	async ({ id: instanceId, projectId }) => {
		requirePermission(instanceId, 'mods');
		return userFacing(() => packs.listPackVersions(instanceId, projectId));
	}
);

export const serverPack = query(id, async (instanceId) => {
	requirePermission(instanceId, 'mods');
	return packs.serverPack(instanceId);
});

export const useResourcePack = command(
	v.object({ id, projectId, versionId }),
	async ({ id: instanceId, projectId, versionId }) => {
		requirePermission(instanceId, 'mods');
		const result = await userFacing(() => packs.useAsServerPack(instanceId, projectId, versionId));
		await serverPack(instanceId).refresh();
		return result;
	}
);

export const removePack = command(
	v.object({ id, rowId: idSchema }),
	async ({ id: instanceId, rowId }) => {
		requirePermission(instanceId, 'mods');
		await userFacing(async () => packs.removePack(instanceId, rowId));
		await serverPack(instanceId).refresh();
	}
);

export const setPackOptions = form(
	packOptionsSchema,
	async ({ id: instanceId, required, prompt }) => {
		requirePermission(instanceId, 'mods');
		await userFacing(async () => packs.setServerPackOptions(instanceId, { required, prompt }));
		await serverPack(instanceId).refresh();
	}
);
