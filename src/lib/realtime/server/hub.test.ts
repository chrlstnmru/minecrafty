import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Permission } from '#lib/permissions.js';

import { CLOSE_BAD_MESSAGE, CLOSE_SIGNED_OUT, type ServerMessage } from '#lib/realtime/protocol.js';
import * as A from '#lib/server/access.js';
import { db } from '#lib/server/db/index.js';
import { instances, roles, sessions, users } from '#lib/server/db/schema.js';
import { serverDir } from '#lib/server/instances.js';
import * as U from '#lib/server/user-admin.js';
import { makeInstance } from '#test/instance.js';
import { makeRole } from '#test/roles.js';

import { admit, SocketSession, type Socket } from './hub';

let id: number;

const hash = (token: string) => new Bun.CryptoHasher('sha256').update(token).digest('hex');

/** A signed-in session for a user holding `permissions` on the instance; returns its token. */
async function signIn(name: string, permissions: Permission[] | 'owner') {
	const user = await U.createAccount(
		name,
		'a-long-password',
		permissions === 'owner' ? 'owner' : 'user'
	);
	if (permissions !== 'owner') A.setAssignments(user.id, id, [makeRole(name, 10, permissions)]);
	const token = `token-${name}`;
	db.insert(sessions)
		.values({ id: hash(token), userId: user.id, expiresAt: new Date(Date.now() + 60_000) })
		.run();
	return token;
}

function socket() {
	const sent: ServerMessage[] = [];
	const closed: number[] = [];
	const fake: Socket = {
		send: (text) => void sent.push(JSON.parse(text)),
		buffered: () => 0,
		close: (code) => void closed.push(code)
	};
	return { fake, sent, closed };
}

const until = async (check: () => boolean, ms = 2000) => {
	const deadline = Date.now() + ms;
	while (!check()) {
		if (Date.now() > deadline) throw new Error('timed out');
		await Bun.sleep(5);
	}
};

const request = (headers: Record<string, string>) =>
	new Request('http://panel.test/_ws', { headers: { host: 'panel.test', ...headers } });

beforeEach(() => {
	db.delete(instances).run();
	db.delete(users).run();
	db.delete(roles).run();
	id = makeInstance().id;
	mkdirSync(join(serverDir(id), 'logs'), { recursive: true });
	writeFileSync(join(serverDir(id), 'logs', 'latest.log'), 'a\n');
});

describe('admit', () => {
	it('takes the session token from a socket opened by the panel itself', () => {
		expect(admit(request({ origin: 'http://panel.test', cookie: 'x=1; session=abc' }))).toEqual({
			token: 'abc'
		});
	});

	it('refuses a socket opened by a page on another site', () => {
		const refused = admit(request({ origin: 'https://evil.test', cookie: 'session=abc' }));
		expect(refused).toBeInstanceOf(Response);
		expect((refused as Response).status).toBe(403);
		expect(admit(request({ cookie: 'session=abc' }))).toBeInstanceOf(Response);
	});
});

describe('SocketSession', () => {
	it('closes a socket that has no session', () => {
		const { fake, closed } = socket();
		const session = new SocketSession(fake, 'nobody');
		expect(closed).toEqual([CLOSE_SIGNED_OUT]);
		session.close();
	});

	it('closes a socket that sends something it does not understand', async () => {
		const { fake, closed } = socket();
		const session = new SocketSession(fake, await signIn('root', 'owner'));
		session.message('{"type":"subscribe","sub":1,"feed":"files","instance":1}');
		session.message('not json');
		expect(closed).toEqual([CLOSE_BAD_MESSAGE, CLOSE_BAD_MESSAGE]);
		session.close();
	});

	it('follows the log, and stops once the page unsubscribes', async () => {
		const { fake, sent } = socket();
		const session = new SocketSession(fake, await signIn('root', 'owner'));
		session.message(JSON.stringify({ type: 'subscribe', sub: 3, feed: 'log', instance: id }));
		await until(() => sent.length === 1);
		expect(sent[0]).toEqual({ type: 'frame', sub: 3, frame: { epoch: 0, total: 1, lines: [] } });

		appendFileSync(join(serverDir(id), 'logs', 'latest.log'), 'b\n');
		await until(() => sent.length === 2);
		expect(sent[1]).toMatchObject({ sub: 3, frame: { total: 2, lines: [{ n: 2, text: 'b' }] } });

		session.message(JSON.stringify({ type: 'unsubscribe', sub: 3 }));
		appendFileSync(join(serverDir(id), 'logs', 'latest.log'), 'c\n');
		await Bun.sleep(700);
		expect(sent).toHaveLength(2);
		session.close();
	});

	it('refuses a feed the user may not see, the way the remote functions do', async () => {
		const { fake, sent } = socket();
		const session = new SocketSession(fake, await signIn('viewer', ['console']));
		session.message(JSON.stringify({ type: 'subscribe', sub: 1, feed: 'log', instance: id }));
		session.message(JSON.stringify({ type: 'subscribe', sub: 2, feed: 'log', instance: id + 99 }));
		expect(sent).toEqual([
			{ type: 'error', sub: 1, status: 403, message: 'You do not have permission to see this' },
			{ type: 'error', sub: 2, status: 404, message: 'Instance not found' }
		]);
		session.close();
	});

	it('ends the socket once its session is gone, and a feed whose permission was taken away', async () => {
		const { fake, sent, closed } = socket();
		const token = await signIn('helper', ['logs']);
		const session = new SocketSession(fake, token);
		session.message(JSON.stringify({ type: 'subscribe', sub: 1, feed: 'log', instance: id }));
		await until(() => sent.length === 1);

		db.delete(roles).run();
		session.recheck();
		expect(sent.at(-1)).toEqual({
			type: 'error',
			sub: 1,
			status: 404,
			message: 'Instance not found'
		});

		db.delete(sessions).run();
		session.recheck();
		expect(closed).toEqual([CLOSE_SIGNED_OUT]);
	});
});
