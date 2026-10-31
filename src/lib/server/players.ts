import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlayerAction } from '#lib/schemas/players.js';
import { isRunning } from './files';
import { getInstance, serverDir } from './instances';
import { RconError } from './rcon';
import { rconCommand } from './rcon-sessions';
import { readProperties, setProperties } from './server-properties';

export type ListedPlayer = { uuid: string; name: string };
export type Operator = ListedPlayer & { level: number };
export type Ban = ListedPlayer & {
	created: string;
	source: string;
	expires: string;
	reason: string;
};
export type IpBan = {
	ip: string;
	created: string;
	source: string;
	expires: string;
	reason: string;
};

export type PlayerLists = {
	whitelist: ListedPlayer[];
	ops: Operator[];
	bans: Ban[];
	ipBans: IpBan[];
	whitelistEnabled: boolean;
};

const file = (instanceId: number, name: string) => join(serverDir(instanceId), name);

/** A list the server keeps as JSON; a missing or damaged file is an empty list. */
function readJson<T>(path: string): T[] {
	if (!existsSync(path)) return [];
	try {
		const data = JSON.parse(readFileSync(path, 'utf8')) as unknown;
		return Array.isArray(data) ? (data as T[]) : [];
	} catch {
		return [];
	}
}

/** Written in one move, so a server reading the file never sees half of it. */
function writeJson(path: string, data: unknown) {
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, JSON.stringify(data, null, 2));
	renameSync(tmp, path);
}

const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);

/** Everything the server remembers about players, read from its own files whether it runs or not. */
export function readPlayerLists(instanceId: number): PlayerLists {
	const properties = readProperties(file(instanceId, 'server.properties'));
	const named = (row: { uuid?: unknown; name?: unknown }) => ({
		uuid: text(row.uuid),
		name: text(row.name)
	});
	return {
		whitelist: readJson<ListedPlayer>(file(instanceId, 'whitelist.json')).map(named),
		ops: readJson<Operator>(file(instanceId, 'ops.json')).map((row) => ({
			...named(row),
			level: typeof row.level === 'number' ? row.level : 4
		})),
		bans: readJson<Ban>(file(instanceId, 'banned-players.json')).map((row) => ({
			...named(row),
			created: text(row.created),
			source: text(row.source),
			expires: text(row.expires, 'forever'),
			reason: text(row.reason)
		})),
		ipBans: readJson<IpBan>(file(instanceId, 'banned-ips.json')).map((row) => ({
			ip: text(row.ip),
			created: text(row.created),
			source: text(row.source),
			expires: text(row.expires, 'forever'),
			reason: text(row.reason)
		})),
		whitelistEnabled: properties['white-list'] === 'true'
	};
}

export type Online =
	| { state: 'stopped' }
	| { state: 'unavailable'; reason: string }
	| { state: 'online'; count: number; max: number | null; names: string[] };

/**
 * Reads the reply to `list`: "There are 2 of a max of 20 players online: A, B" on vanilla, and
 * "There are 2 out of maximum 20 players online." followed by "group: A, B" lines on Paper.
 */
export function parseList(reply: string) {
	const lines = reply
		.replace(/§./g, '')
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const head = lines[0] ?? '';
	const count = Number(head.match(/There are (\d+)/i)?.[1] ?? 0);
	const max = head.match(/(?:of a max of|out of maximum) (\d+)/i)?.[1];

	const names: string[] = [];
	const add = (list: string) => {
		for (const name of list.split(',')) if (name.trim()) names.push(name.trim());
	};
	const colon = head.indexOf(':');
	if (colon >= 0) add(head.slice(colon + 1));
	// Paper puts each group on its own line, the first being "default: ..." after the header
	for (const line of lines.slice(1)) add(line.slice(line.indexOf(':') + 1));
	return {
		count: Math.max(count, names.length),
		max: max ? Number(max) : null,
		names: [...new Set(names)]
	};
}

function rconTarget(instanceId: number) {
	const inst = getInstance(instanceId);
	if (!inst) throw new Error('Instance not found');
	if (!inst.rconPort || !inst.rconPassword) return null;
	return { port: inst.rconPort, password: inst.rconPassword };
}

const rconProblem = (e: unknown) =>
	e instanceof RconError && (e.kind === 'refused' || e.kind === 'timeout')
		? 'RCON is not answering yet. It is switched on when the server starts, so a server that was already running needs a restart; a server that is still starting needs a moment.'
		: e instanceof Error
			? e.message
			: 'Could not reach the server';

/** Who is on the server right now. */
export async function onlinePlayers(instanceId: number): Promise<Online> {
	if (!(await isRunning(instanceId))) return { state: 'stopped' };
	const target = rconTarget(instanceId);
	if (!target)
		return {
			state: 'unavailable',
			reason:
				'RCON is switched on the next time the server starts. Restart it to see who is online.'
		};
	try {
		const reply = await rconCommand(instanceId, target, 'list');
		return { state: 'online', ...parseList(reply) };
	} catch (e) {
		return { state: 'unavailable', reason: rconProblem(e) };
	}
}

const hyphenate = (hex: string) =>
	`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

/** The UUID an offline-mode server gives a name: a version 3 UUID of "OfflinePlayer:<name>". */
export function offlineUuid(name: string) {
	const bytes = createHash('md5').update(`OfflinePlayer:${name}`).digest();
	bytes[6] = (bytes[6] & 0x0f) | 0x30;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	return hyphenate(bytes.toString('hex'));
}

/** Mojang's account of a name, with the name as it is really spelled. */
async function mojangProfile(name: string): Promise<ListedPlayer> {
	let res: Response;
	try {
		res = await fetch(
			`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`,
			{
				signal: AbortSignal.timeout(8000)
			}
		);
	} catch {
		throw new Error(
			'Could not reach Mojang to look the player up. Try again, or start the server.'
		);
	}
	if (res.status === 204 || res.status === 404) throw new Error(`There is no player named ${name}`);
	if (!res.ok) throw new Error(`Mojang responded ${res.status}`);
	const profile = (await res.json()) as { id: string; name: string };
	return { uuid: hyphenate(profile.id), name: profile.name };
}

/** The player a name stands for, on a server that checks accounts (online mode) or not. */
export async function resolvePlayer(instanceId: number, name: string): Promise<ListedPlayer> {
	const online = readProperties(file(instanceId, 'server.properties'))['online-mode'] !== 'false';
	return online ? mojangProfile(name) : { uuid: offlineUuid(name), name };
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** "2025-01-05 12:00:00 +0000", the way the server writes the time of a ban. */
const stamp = () => `${new Date().toISOString().slice(0, 19).replace('T', ' ')} +0000`;

const BAN_REASON = 'Banned by an operator.';

/** The command for an action; the schema has already checked every name, address and reason. */
export function commandFor(action: PlayerAction) {
	switch (action.type) {
		case 'whitelist-add':
			return `whitelist add ${action.name}`;
		case 'whitelist-remove':
			return `whitelist remove ${action.name}`;
		case 'op':
			return `op ${action.name}`;
		case 'deop':
			return `deop ${action.name}`;
		case 'pardon':
			return `pardon ${action.name}`;
		case 'pardon-ip':
			return `pardon-ip ${action.ip}`;
		case 'ban':
			return action.reason ? `ban ${action.name} ${action.reason}` : `ban ${action.name}`;
		case 'kick':
			return action.reason ? `kick ${action.name} ${action.reason}` : `kick ${action.name}`;
		case 'ban-ip':
			return action.reason ? `ban-ip ${action.ip} ${action.reason}` : `ban-ip ${action.ip}`;
	}
}

/** Applies an action to the server's files while it is stopped; returns what happened. */
async function editFiles(instanceId: number, action: PlayerAction) {
	const path = (name: string) => file(instanceId, name);
	switch (action.type) {
		case 'whitelist-add': {
			const player = await resolvePlayer(instanceId, action.name);
			const list = readJson<ListedPlayer>(path('whitelist.json'));
			if (list.some((p) => same(p.name, player.name)))
				return `${player.name} is already whitelisted`;
			writeJson(path('whitelist.json'), [...list, player]);
			return `Added ${player.name} to the whitelist`;
		}
		case 'whitelist-remove': {
			const list = readJson<ListedPlayer>(path('whitelist.json'));
			const rest = list.filter((p) => !same(p.name, action.name));
			if (rest.length === list.length) return `${action.name} is not whitelisted`;
			writeJson(path('whitelist.json'), rest);
			return `Removed ${action.name} from the whitelist`;
		}
		case 'op': {
			const player = await resolvePlayer(instanceId, action.name);
			const list = readJson<Operator>(path('ops.json'));
			if (list.some((p) => same(p.name, player.name)))
				return `${player.name} is already an operator`;
			writeJson(path('ops.json'), [...list, { ...player, level: 4, bypassesPlayerLimit: false }]);
			return `Made ${player.name} an operator`;
		}
		case 'deop': {
			const list = readJson<Operator>(path('ops.json'));
			const rest = list.filter((p) => !same(p.name, action.name));
			if (rest.length === list.length) return `${action.name} is not an operator`;
			writeJson(path('ops.json'), rest);
			return `${action.name} is no longer an operator`;
		}
		case 'ban': {
			const player = await resolvePlayer(instanceId, action.name);
			const list = readJson<Ban>(path('banned-players.json'));
			if (list.some((p) => same(p.name, player.name))) return `${player.name} is already banned`;
			writeJson(path('banned-players.json'), [
				...list,
				{
					...player,
					created: stamp(),
					source: 'Panel',
					expires: 'forever',
					reason: action.reason || BAN_REASON
				}
			]);
			return `Banned ${player.name}`;
		}
		case 'pardon': {
			const list = readJson<Ban>(path('banned-players.json'));
			const rest = list.filter((p) => !same(p.name, action.name));
			if (rest.length === list.length) return `${action.name} is not banned`;
			writeJson(path('banned-players.json'), rest);
			return `Unbanned ${action.name}`;
		}
		case 'ban-ip': {
			const list = readJson<IpBan>(path('banned-ips.json'));
			if (list.some((p) => p.ip === action.ip)) return `${action.ip} is already banned`;
			writeJson(path('banned-ips.json'), [
				...list,
				{
					ip: action.ip,
					created: stamp(),
					source: 'Panel',
					expires: 'forever',
					reason: action.reason || BAN_REASON
				}
			]);
			return `Banned ${action.ip}`;
		}
		case 'pardon-ip': {
			const list = readJson<IpBan>(path('banned-ips.json'));
			const rest = list.filter((p) => p.ip !== action.ip);
			if (rest.length === list.length) return `${action.ip} is not banned`;
			writeJson(path('banned-ips.json'), rest);
			return `Unbanned ${action.ip}`;
		}
		case 'kick':
			throw new Error('Only a player who is online can be kicked, and the server is stopped');
	}
}

/**
 * Carries out an action: as a command over RCON while the server runs (so it applies at once and
 * the server does its own checks), by editing its files while it is stopped. Returns the message
 * to show; a server answers in plain text, whether or not it did what was asked.
 */
export async function runPlayerAction(instanceId: number, action: PlayerAction) {
	if (!getInstance(instanceId)) throw new Error('Instance not found');
	if (!(await isRunning(instanceId))) return editFiles(instanceId, action);

	const target = rconTarget(instanceId);
	if (!target)
		throw new Error('RCON is switched on the next time the server starts. Restart it first.');
	try {
		const reply = await rconCommand(instanceId, target, commandFor(action));
		return reply.replace(/§./g, '').trim() || 'Done';
	} catch (e) {
		throw new Error(rconProblem(e));
	}
}

/** Turns the whitelist on or off: a command while running, the setting while stopped. */
export async function setWhitelistEnabled(instanceId: number, enabled: boolean) {
	if (!getInstance(instanceId)) throw new Error('Instance not found');
	setProperties(file(instanceId, 'server.properties'), { 'white-list': enabled });
	if (!(await isRunning(instanceId))) return;
	const target = rconTarget(instanceId);
	if (!target) return;
	try {
		await rconCommand(instanceId, target, `whitelist ${enabled ? 'on' : 'off'}`);
	} catch (e) {
		throw new Error(rconProblem(e));
	}
}
