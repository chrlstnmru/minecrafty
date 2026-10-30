import { error } from '@sveltejs/kit';
import { query } from '$app/server';
import { getInstance } from '#lib/server/instances.js';
import { idSchema } from '#lib/schemas/common.js';
import { readLogSchema, searchLogSchema } from '#lib/schemas/logs.js';
import { requirePermission } from '#lib/server/auth.js';
import { userFacing } from '#lib/server/http.js';
import * as logs from '#lib/server/logs.js';

export const listLogs = query(idSchema, async (id) => {
	requirePermission(id, 'view');
	return userFacing(async () => logs.listLogs(id));
});

export const readLog = query(readLogSchema, async ({ id, name, lines }) => {
	requirePermission(id, 'view');
	return userFacing(() => logs.readLog(id, name, lines));
});

export const searchLog = query(searchLogSchema, async ({ id, name, query: text, matchCase }) => {
	requirePermission(id, 'view');
	return userFacing(() => logs.searchLog(id, name, text, { matchCase }));
});

/** New lines of `latest.log` as the server writes them. */
export const followLog = query.live(idSchema, async function* (id) {
	requirePermission(id, 'view');
	if (!getInstance(id)) error(404, 'Instance not found');
	yield* logs.followLog(id);
});
