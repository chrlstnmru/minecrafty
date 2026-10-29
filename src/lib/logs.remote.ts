import { query } from '$app/server';
import { idSchema } from '#lib/schemas/common.js';
import { readLogSchema, searchLogSchema } from '#lib/schemas/logs.js';
import { requireAdmin } from '#lib/server/auth.js';
import { userFacing } from '#lib/server/http.js';
import * as logs from '#lib/server/logs.js';

export const listLogs = query(idSchema, async (id) => {
	requireAdmin();
	return userFacing(async () => logs.listLogs(id));
});

export const readLog = query(readLogSchema, async ({ id, name, lines }) => {
	requireAdmin();
	return userFacing(() => logs.readLog(id, name, lines));
});

export const searchLog = query(searchLogSchema, async ({ id, name, query: text, matchCase }) => {
	requireAdmin();
	return userFacing(() => logs.searchLog(id, name, text, { matchCase }));
});
