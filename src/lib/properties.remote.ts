import { command, query } from '$app/server';
import { idSchema } from '#lib/schemas/common.js';
import { savePropertiesSchema } from '#lib/schemas/properties.js';
import { restrictionsFor } from '#lib/server/access.js';
import { requirePermission } from '#lib/server/auth.js';
import { isRunning } from '#lib/server/files.js';
import { userFacing } from '#lib/server/http.js';
import * as properties from '#lib/server/properties.js';

export const serverProperties = query(idSchema, async (id) => {
	const user = requirePermission(id, 'files');
	return userFacing(async () => ({
		...properties.getServerProperties(id),
		locked: restrictionsFor(user, id).properties,
		running: await isRunning(id)
	}));
});

export const saveServerProperties = command(savePropertiesSchema, async ({ id, values }) => {
	const user = requirePermission(id, 'files');
	const { properties: locked } = restrictionsFor(user, id);
	await userFacing(async () => properties.saveServerProperties(id, values, locked));
	await serverProperties(id).refresh();
});
