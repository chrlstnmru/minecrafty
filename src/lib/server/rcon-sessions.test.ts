import { afterEach, describe, expect, it } from 'vitest';
import { fakeRcon, stopFakeRcon } from '#test/fake-rcon.js';
import { closeAllRcon, rconCommand } from './rcon-sessions';

afterEach(() => {
	closeAllRcon();
	stopFakeRcon();
});

describe('rconCommand', () => {
	it('keeps one connection open for every command', async () => {
		const server = fakeRcon('pw', (c) => `ran: ${c}`);
		const target = { port: server.port, password: 'pw' };
		expect(await rconCommand(1, target, 'list')).toBe('ran: list');
		expect(await rconCommand(1, target, 'list')).toBe('ran: list');
		expect(await rconCommand(1, target, 'whitelist on')).toBe('ran: whitelist on');
		expect(server.connections).toBe(1);
	});

	it('gives each of several commands sent at once its own reply', async () => {
		const server = fakeRcon('pw', (c) => c.toUpperCase());
		const target = { port: server.port, password: 'pw' };
		const replies = await Promise.all(['a', 'b', 'c'].map((c) => rconCommand(1, target, c)));
		expect(replies).toEqual(['A', 'B', 'C']);
		expect(server.connections).toBe(1);
	});

	it('connects again once the server has restarted', async () => {
		const first = fakeRcon('pw', () => 'first');
		const target = { port: first.port, password: 'pw' };
		expect(await rconCommand(1, target, 'list')).toBe('first');
		stopFakeRcon();
		await Bun.sleep(20);
		const second = fakeRcon('pw', () => 'second', { port: first.port });
		expect(await rconCommand(1, target, 'list')).toBe('second');
		expect(second.received).toEqual(['list']);
	});

	it('opens a new connection when the port or password changes', async () => {
		const a = fakeRcon('one', () => 'a');
		const b = fakeRcon('two', () => 'b');
		expect(await rconCommand(1, { port: a.port, password: 'one' }, 'list')).toBe('a');
		expect(await rconCommand(1, { port: b.port, password: 'two' }, 'list')).toBe('b');
	});

	it('keeps each server on its own connection', async () => {
		const a = fakeRcon('pw', () => 'a');
		const b = fakeRcon('pw', () => 'b');
		expect(await rconCommand(1, { port: a.port, password: 'pw' }, 'list')).toBe('a');
		expect(await rconCommand(2, { port: b.port, password: 'pw' }, 'list')).toBe('b');
		expect(await rconCommand(1, { port: a.port, password: 'pw' }, 'list')).toBe('a');
		expect([a.connections, b.connections]).toEqual([1, 1]);
	});

	it('drops a connection that timed out, and starts afresh next time', async () => {
		const silent = fakeRcon('pw', () => '', { silent: true });
		const error = await rconCommand(1, { port: silent.port, password: 'pw' }, 'list', 200).catch(
			(e) => e
		);
		expect(error.kind).toBe('timeout');
		const server = fakeRcon('pw', () => 'ok');
		expect(await rconCommand(1, { port: server.port, password: 'pw' }, 'list')).toBe('ok');
	});
});
