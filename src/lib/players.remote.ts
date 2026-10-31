import { command, query } from '$app/server';
import * as v from 'valibot';

import { idSchema } from '#lib/schemas/common.js';
import { playerActionSchema, type PlayerAction } from '#lib/schemas/players.js';
import { record } from '#lib/server/audit.js';
import { requirePermission } from '#lib/server/auth.js';
import { userFacing } from '#lib/server/http.js';
import * as players from '#lib/server/players.js';

const describePlayerAction = (a: PlayerAction) => {
	switch (a.type) {
		case 'whitelist-add':
			return `Added ${a.name} to the whitelist`;
		case 'whitelist-remove':
			return `Removed ${a.name} from the whitelist`;
		case 'op':
			return `Made ${a.name} an operator`;
		case 'deop':
			return `Removed ${a.name} as operator`;
		case 'ban':
			return `Banned ${a.name}${a.reason ? `: ${a.reason}` : ''}`;
		case 'pardon':
			return `Pardoned ${a.name}`;
		case 'kick':
			return `Kicked ${a.name}${a.reason ? `: ${a.reason}` : ''}`;
		case 'ban-ip':
			return `Banned the address ${a.ip}${a.reason ? `: ${a.reason}` : ''}`;
		case 'pardon-ip':
			return `Pardoned the address ${a.ip}`;
	}
};

/** The whitelist, operators and bans, read from the server's own files. */
export const playerLists = query(idSchema, async (instanceId) => {
	requirePermission(instanceId, 'players');
	return userFacing(async () => players.readPlayerLists(instanceId));
});

/** Who is on the server right now; the page asks again every few seconds. */
export const onlineNow = query(idSchema, async (instanceId) => {
	requirePermission(instanceId, 'players');
	return userFacing(() => players.onlinePlayers(instanceId));
});

/** Runs one action and returns what the server (or the panel, with the server stopped) answered. */
export const playerAction = command(playerActionSchema, async ({ id, action }) => {
	requirePermission(id, 'players');
	const message = await userFacing(() => players.runPlayerAction(id, action));
	record({
		action: `player.${action.type}`,
		summary: describePlayerAction(action),
		instanceId: id
	});
	await Promise.all([playerLists(id).refresh(), onlineNow(id).refresh()]);
	return message;
});

export const setWhitelist = command(
	v.object({ id: idSchema, enabled: v.boolean() }),
	async ({ id, enabled }) => {
		requirePermission(id, 'players');
		await userFacing(() => players.setWhitelistEnabled(id, enabled));
		record({
			action: 'player.whitelist',
			summary: `${enabled ? 'Turned on' : 'Turned off'} the whitelist`,
			instanceId: id
		});
		await playerLists(id).refresh();
	}
);
