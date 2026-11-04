import { command, query } from '$app/server';

import { idSchema } from '#lib/schemas/common.js';
import { savePropertiesSchema, savePropertiesTextSchema } from '#lib/schemas/properties.js';
import { record } from '#lib/server/audit.js';
import { requirePermission } from '#lib/server/auth.js';
import { userFacing } from '#lib/server/http.js';
import { isRunning } from '#lib/server/live-server.js';
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
	const keys = Object.keys(values);
	if (keys.length)
		record({
			action: 'properties.save',
			summary: `Edited server.properties (${keys.join(', ')})`,
			instanceId: id
		});
	await Promise.all([serverProperties(id).refresh(), serverPropertiesText(id).refresh()]);
});

export const serverPropertiesText = query(idSchema, async (id) => {
	requirePermission(id, 'properties');
	return userFacing(async () => properties.getServerPropertiesText(id));
});

export const saveServerPropertiesText = command(savePropertiesTextSchema, async ({ id, text }) => {
	requirePermission(id, 'properties');
	const changed = await userFacing(async () => properties.saveServerPropertiesText(id, text));
	if (changed)
		record({
			action: 'properties.save',
			summary: 'Edited server.properties as a file',
			instanceId: id
		});
	await Promise.all([serverProperties(id).refresh(), serverPropertiesText(id).refresh()]);
});
