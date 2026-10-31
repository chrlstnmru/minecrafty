import { command, form, query } from '$app/server';
import * as v from 'valibot';

import {
	idSchema,
	projectIdSchema,
	searchArgsSchema,
	versionIdSchema
} from '#lib/schemas/common.js';
import { packOptionsSchema } from '#lib/schemas/packs.js';
import { record } from '#lib/server/audit.js';
import { requirePermission } from '#lib/server/auth.js';
import { userFacing } from '#lib/server/http.js';
import * as packs from '#lib/server/packs.js';

const id = idSchema;
const projectId = projectIdSchema;
const versionId = versionIdSchema;

export const searchPacks = query(searchArgsSchema, async ({ id: instanceId, query, limit }) => {
	requirePermission(instanceId, 'resource-packs');
	return userFacing(() => packs.search(instanceId, query.trim(), limit));
});

export const packVersions = query(
	v.object({ id, projectId }),
	async ({ id: instanceId, projectId }) => {
		requirePermission(instanceId, 'resource-packs');
		return userFacing(() => packs.listPackVersions(instanceId, projectId));
	}
);

export const serverPack = query(id, async (instanceId) => {
	requirePermission(instanceId, 'resource-packs');
	return packs.serverPack(instanceId);
});

export const useResourcePack = command(
	v.object({ id, projectId, versionId }),
	async ({ id: instanceId, projectId, versionId }) => {
		requirePermission(instanceId, 'resource-packs');
		const result = await userFacing(() => packs.useAsServerPack(instanceId, projectId, versionId));
		record({
			action: 'resourcepack.use',
			summary: 'Set the server resource pack',
			instanceId
		});
		await serverPack(instanceId).refresh();
		return result;
	}
);

export const removePack = command(
	v.object({ id, rowId: idSchema }),
	async ({ id: instanceId, rowId }) => {
		requirePermission(instanceId, 'resource-packs');
		await userFacing(async () => packs.removePack(instanceId, rowId));
		record({
			action: 'resourcepack.remove',
			summary: 'Removed a resource pack',
			instanceId
		});
		await serverPack(instanceId).refresh();
	}
);

export const setPackOptions = form(
	packOptionsSchema,
	async ({ id: instanceId, required, prompt }) => {
		requirePermission(instanceId, 'resource-packs');
		await userFacing(async () => packs.setServerPackOptions(instanceId, { required, prompt }));
		record({
			action: 'resourcepack.options',
			summary: 'Changed the resource pack options',
			instanceId
		});
		await serverPack(instanceId).refresh();
	}
);
