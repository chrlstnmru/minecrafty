import * as v from 'valibot';
import { command, query } from '$app/server';
import { idSchema } from '#lib/schemas/common.js';
import { playerActionSchema } from '#lib/schemas/players.js';
import { requireAdmin } from '#lib/server/auth.js';
import { userFacing } from '#lib/server/http.js';
import * as players from '#lib/server/players.js';

/** The whitelist, operators and bans, read from the server's own files. */
export const playerLists = query(idSchema, async (instanceId) => {
	requireAdmin();
	return userFacing(async () => players.readPlayerLists(instanceId));
});

/** Who is on the server right now; the page asks again every few seconds. */
export const onlineNow = query(idSchema, async (instanceId) => {
	requireAdmin();
	return userFacing(() => players.onlinePlayers(instanceId));
});

/** Runs one action and returns what the server (or the panel, with the server stopped) answered. */
export const playerAction = command(playerActionSchema, async ({ id, action }) => {
	requireAdmin();
	const message = await userFacing(() => players.runPlayerAction(id, action));
	await Promise.all([playerLists(id).refresh(), onlineNow(id).refresh()]);
	return message;
});

export const setWhitelist = command(
	v.object({ id: idSchema, enabled: v.boolean() }),
	async ({ id, enabled }) => {
		requireAdmin();
		await userFacing(() => players.setWhitelistEnabled(id, enabled));
		await playerLists(id).refresh();
	}
);
