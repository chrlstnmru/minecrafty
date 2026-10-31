import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as v from 'valibot';
import { eq } from 'drizzle-orm';
import { runner } from '#test/fake-runner.js';
import { makeInstance } from '#test/instance.js';
import { fakeRcon, stopFakeRcon } from '#test/fake-rcon.js';
import { closeAllRcon } from './rcon-sessions';
import { playerActionSchema } from '#lib/schemas/players.js';
import { db } from './db';
import { instances } from './db/schema';

vi.mock('./runner-client', async () => (await import('#test/fake-runner.js')).fakeRunnerClient);

const P = await import('./players');
const { serverDir } = await import('./instances');

let id: number;
let root: string;
const put = (name: string, data: unknown) =>
	writeFileSync(join(root, name), typeof data === 'string' ? data : JSON.stringify(data));
const read = (name: string) => JSON.parse(readFileSync(join(root, name), 'utf8'));
const withRcon = (handler: (command: string) => string) => {
	const server = fakeRcon('pw', handler);
	db.update(instances)
		.set({ rconPort: server.port, rconPassword: 'pw' })
		.where(eq(instances.id, id))
		.run();
	return server;
};

beforeEach(() => {
	runner.running = false;
	id = makeInstance().id;
	root = serverDir(id);
	mkdirSync(root, { recursive: true });
	// offline mode: names map to UUIDs without asking Mojang
	put('server.properties', 'online-mode=false\n');
});
afterEach(() => {
	closeAllRcon();
	stopFakeRcon();
	vi.unstubAllGlobals();
});

describe('parseList', () => {
	it('reads the vanilla reply', () => {
		expect(P.parseList('There are 2 of a max of 20 players online: Steve, Alex')).toEqual({
			count: 2,
			max: 20,
			names: ['Steve', 'Alex']
		});
	});

	it('reads an empty server', () => {
		expect(P.parseList('There are 0 of a max of 20 players online: ')).toEqual({
			count: 0,
			max: 20,
			names: []
		});
	});

	it("reads Paper's groups, one per line", () => {
		const reply =
			'There are 3 out of maximum 50 players online.\ndefault: Steve, Alex\nadmin: Notch';
		expect(P.parseList(reply)).toEqual({
			count: 3,
			max: 50,
			names: ['Steve', 'Alex', 'Notch']
		});
	});

	it('drops colour codes and repeats, and copes with a reply it does not know', () => {
		expect(P.parseList('There are 1 of a max of 5 players online: §aSteve, Steve').names).toEqual([
			'Steve'
		]);
		expect(P.parseList('')).toEqual({ count: 0, max: null, names: [] });
		expect(P.parseList('something else entirely')).toEqual({ count: 0, max: null, names: [] });
	});
});

describe('readPlayerLists', () => {
	it('is empty before the server has written anything', () => {
		expect(P.readPlayerLists(id)).toEqual({
			whitelist: [],
			ops: [],
			bans: [],
			ipBans: [],
			whitelistEnabled: false
		});
	});

	it('reads what the server wrote, with defaults for what it left out', () => {
		put('whitelist.json', [{ uuid: 'u1', name: 'Steve' }]);
		put('ops.json', [
			{ uuid: 'u2', name: 'Alex', level: 2, bypassesPlayerLimit: false },
			{ name: 'NoLevel' }
		]);
		put('banned-players.json', [
			{ uuid: 'u3', name: 'Griefer', created: 'c', source: 'Server', reason: 'x' }
		]);
		put('banned-ips.json', [
			{ ip: '10.0.0.1', created: 'c', source: 'Server', expires: 'forever', reason: 'y' }
		]);
		put('server.properties', 'white-list=true\n');
		const lists = P.readPlayerLists(id);
		expect(lists.whitelist).toEqual([{ uuid: 'u1', name: 'Steve' }]);
		expect(lists.ops.map((o) => [o.name, o.level])).toEqual([
			['Alex', 2],
			['NoLevel', 4]
		]);
		expect(lists.bans[0]).toMatchObject({ name: 'Griefer', expires: 'forever', reason: 'x' });
		expect(lists.ipBans[0].ip).toBe('10.0.0.1');
		expect(lists.whitelistEnabled).toBe(true);
	});

	it('treats a damaged file as an empty list', () => {
		put('whitelist.json', '{ not json');
		put('ops.json', '{"not":"a list"}');
		expect(P.readPlayerLists(id).whitelist).toEqual([]);
		expect(P.readPlayerLists(id).ops).toEqual([]);
	});
});

describe('offlineUuid', () => {
	it('matches the UUID an offline server gives a name', () => {
		expect(P.offlineUuid('Notch')).toBe('b50ad385-829d-3141-a216-7e7d7539ba7f');
	});
});

describe('with the server stopped', () => {
	const act = (action: Parameters<typeof P.runPlayerAction>[1]) => P.runPlayerAction(id, action);

	it('whitelists and removes a player by editing the file', async () => {
		expect(await act({ type: 'whitelist-add', name: 'Steve' })).toMatch(/Added Steve/);
		expect(read('whitelist.json')).toEqual([{ uuid: P.offlineUuid('Steve'), name: 'Steve' }]);
		expect(await act({ type: 'whitelist-add', name: 'steve' })).toMatch(/already whitelisted/);
		expect(read('whitelist.json')).toHaveLength(1);
		expect(await act({ type: 'whitelist-remove', name: 'STEVE' })).toMatch(/Removed/);
		expect(read('whitelist.json')).toEqual([]);
		expect(await act({ type: 'whitelist-remove', name: 'Steve' })).toMatch(/not whitelisted/);
	});

	it('makes and unmakes an operator at the top level', async () => {
		await act({ type: 'op', name: 'Alex' });
		expect(read('ops.json')[0]).toMatchObject({
			name: 'Alex',
			level: 4,
			bypassesPlayerLimit: false
		});
		await act({ type: 'deop', name: 'Alex' });
		expect(read('ops.json')).toEqual([]);
	});

	it('bans with a reason, or the default one, and pardons', async () => {
		await act({ type: 'ban', name: 'Griefer', reason: 'Broke the spawn' });
		await act({ type: 'ban', name: 'Other' });
		const bans = read('banned-players.json');
		expect(bans[0]).toMatchObject({
			name: 'Griefer',
			reason: 'Broke the spawn',
			expires: 'forever',
			source: 'Panel'
		});
		expect(bans[0].created).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d \+0000$/);
		expect(bans[1].reason).toBe('Banned by an operator.');
		await act({ type: 'pardon', name: 'griefer' });
		expect(read('banned-players.json').map((b: { name: string }) => b.name)).toEqual(['Other']);
	});

	it('bans and unbans an address', async () => {
		await act({ type: 'ban-ip', ip: '10.0.0.7', reason: 'spam' });
		expect(read('banned-ips.json')[0]).toMatchObject({ ip: '10.0.0.7', reason: 'spam' });
		expect(await act({ type: 'ban-ip', ip: '10.0.0.7' })).toMatch(/already banned/);
		await act({ type: 'pardon-ip', ip: '10.0.0.7' });
		expect(read('banned-ips.json')).toEqual([]);
	});

	it('cannot kick anyone', async () => {
		await expect(act({ type: 'kick', name: 'Steve' })).rejects.toThrow(/stopped/);
	});

	it('asks Mojang on an online-mode server, and uses the name as Mojang spells it', async () => {
		put('server.properties', 'online-mode=true\n');
		const fetchMock = vi.fn(async (_url: string) =>
			Response.json({ id: '069a79f444e94726a5befca90e38aaf5', name: 'Notch' })
		);
		vi.stubGlobal('fetch', fetchMock);
		await act({ type: 'whitelist-add', name: 'notch' });
		expect(read('whitelist.json')).toEqual([
			{ uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5', name: 'Notch' }
		]);
		expect(String(fetchMock.mock.calls[0][0])).toContain('/users/profiles/minecraft/notch');
	});

	it('says so when Mojang does not know the name, or cannot be reached', async () => {
		put('server.properties', 'online-mode=true\n');
		vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }));
		await expect(P.runPlayerAction(id, { type: 'op', name: 'Nobody' })).rejects.toThrow(
			/no player named Nobody/
		);
		vi.stubGlobal('fetch', async () => {
			throw new Error('offline');
		});
		await expect(P.runPlayerAction(id, { type: 'op', name: 'Nobody' })).rejects.toThrow(
			/Could not reach Mojang/
		);
		expect(P.readPlayerLists(id).ops).toEqual([]);
	});
});

describe('with the server running', () => {
	beforeEach(() => {
		runner.running = true;
	});

	it('sends commands over RCON and returns what the server says', async () => {
		const { received } = withRcon((c) =>
			c.startsWith('whitelist add') ? 'Added Steve to the whitelist' : '§cNo'
		);
		expect(await P.runPlayerAction(id, { type: 'whitelist-add', name: 'Steve' })).toBe(
			'Added Steve to the whitelist'
		);
		expect(
			await P.runPlayerAction(id, { type: 'kick', name: 'Steve', reason: 'AFK too long' })
		).toBe('No');
		expect(received).toEqual(['whitelist add Steve', 'kick Steve AFK too long']);
	});

	it('does not touch the files, which the server owns while it runs', async () => {
		withRcon(() => 'ok');
		await P.runPlayerAction(id, { type: 'op', name: 'Alex' });
		expect(P.readPlayerLists(id).ops).toEqual([]);
	});

	it('says what to do when RCON was never switched on', async () => {
		await expect(P.runPlayerAction(id, { type: 'op', name: 'Alex' })).rejects.toThrow(/Restart/);
	});

	it('lists who is online', async () => {
		withRcon(() => 'There are 2 of a max of 20 players online: Steve, Alex');
		expect(await P.onlinePlayers(id)).toEqual({
			state: 'online',
			count: 2,
			max: 20,
			names: ['Steve', 'Alex']
		});
	});

	it('explains a server without RCON, and reports a stopped one', async () => {
		expect(await P.onlinePlayers(id)).toMatchObject({ state: 'unavailable' });
		runner.running = false;
		expect(await P.onlinePlayers(id)).toEqual({ state: 'stopped' });
	});

	it('turns the whitelist on and off, in the setting and on the server', async () => {
		const { received } = withRcon(() => 'ok');
		await P.setWhitelistEnabled(id, true);
		expect(P.readPlayerLists(id).whitelistEnabled).toBe(true);
		await P.setWhitelistEnabled(id, false);
		expect(P.readPlayerLists(id).whitelistEnabled).toBe(false);
		expect(received).toEqual(['whitelist on', 'whitelist off']);
	});
});

describe('commandFor', () => {
	it.each([
		[{ type: 'whitelist-add', name: 'A' }, 'whitelist add A'],
		[{ type: 'whitelist-remove', name: 'A' }, 'whitelist remove A'],
		[{ type: 'op', name: 'A' }, 'op A'],
		[{ type: 'deop', name: 'A' }, 'deop A'],
		[{ type: 'pardon', name: 'A' }, 'pardon A'],
		[{ type: 'pardon-ip', ip: '1.2.3.4' }, 'pardon-ip 1.2.3.4'],
		[{ type: 'ban', name: 'A' }, 'ban A'],
		[{ type: 'ban', name: 'A', reason: 'bad' }, 'ban A bad'],
		[{ type: 'kick', name: 'A', reason: 'go' }, 'kick A go'],
		[{ type: 'ban-ip', ip: '1.2.3.4', reason: 'spam' }, 'ban-ip 1.2.3.4 spam']
	] as const)('%j is "%s"', (action, command) => {
		expect(P.commandFor(action as never)).toBe(command);
	});
});

describe('the action schema, which stands between a request and a command', () => {
	const ok = (action: unknown) => v.safeParse(playerActionSchema, { id: 1, action }).success;

	it('accepts real names, including a Floodgate prefix', () => {
		for (const name of ['Steve', 'a_b_9', '.BedrockPlayer', 'x'.repeat(16)])
			expect(ok({ type: 'op', name }), name).toBe(true);
	});

	it.each(['', 'two words', 'Steve; op Me', 'a\nop', 'x'.repeat(17), '../x', 'Ste ve', '@a', '*'])(
		'refuses the name %j',
		(name) => {
			expect(ok({ type: 'op', name })).toBe(false);
		}
	);

	it('refuses a reason with a line break, and one that is too long', () => {
		expect(ok({ type: 'ban', name: 'A', reason: 'fine, spaces are ok' })).toBe(true);
		expect(ok({ type: 'ban', name: 'A', reason: 'a\nop Me' })).toBe(false);
		expect(ok({ type: 'kick', name: 'A', reason: 'x'.repeat(201) })).toBe(false);
	});

	it('takes IPv4 and IPv6 addresses and nothing else', () => {
		expect(ok({ type: 'ban-ip', ip: '10.0.0.1' })).toBe(true);
		expect(ok({ type: 'ban-ip', ip: '::1' })).toBe(true);
		expect(ok({ type: 'ban-ip', ip: 'not an ip' })).toBe(false);
		expect(ok({ type: 'ban-ip', ip: '1.2.3.4 extra' })).toBe(false);
	});

	it('refuses an action it does not know', () => {
		expect(ok({ type: 'stop' })).toBe(false);
	});
});
