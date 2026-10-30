import { command, query } from '$app/server';
import { idSchema } from '#lib/schemas/common.js';
import { savePropertiesSchema } from '#lib/schemas/properties.js';
import { requirePermission } from '#lib/server/auth.js';
import { isRunning } from '#lib/server/files.js';
import { userFacing } from '#lib/server/http.js';
import * as properties from '#lib/server/properties.js';

export const serverProperties = query(idSchema, async (id) => {
	requirePermission(id, 'properties');
	return userFacing(async () => ({
		...properties.getServerProperties(id),
		running: await isRunning(id)
	}));
});

export const saveServerProperties = command(savePropertiesSchema, async ({ id, values }) => {
	requirePermission(id, 'properties');
	await userFacing(async () => properties.saveServerProperties(id, values));
	await serverProperties(id).refresh();
});
