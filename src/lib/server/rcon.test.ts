import { afterEach, describe, expect, it } from 'vitest';
import { fakeRcon as fakeServer, stopFakeRcon } from '#test/fake-rcon.js';
import { RconError, withRcon } from './rcon';

afterEach(stopFakeRcon);

describe('withRcon', () => {
	it('logs in, runs a command and returns what the server said', async () => {
		const { port, received } = fakeServer('secret', (c) => `ran: ${c}`);
		const reply = await withRcon({ port, password: 'secret' }, (run) => run('list'));
		expect(reply).toBe('ran: list');
		expect(received).toEqual(['list']);
	});

	it('runs several commands on one connection, each with its own answer', async () => {
		const { port } = fakeServer('secret', (c) => c.toUpperCase());
		const replies = await withRcon({ port, password: 'secret' }, async (run) => [
			await run('one'),
			await run('two')
		]);
		expect(replies).toEqual(['ONE', 'TWO']);
	});

	it('puts a reply split over several packets back together', async () => {
		const long = 'x'.repeat(10_000) + 'END';
		const { port } = fakeServer('secret', () => long);
		expect(await withRcon({ port, password: 'secret' }, (run) => run('whitelist list'))).toBe(long);
	});

	it('handles an empty reply', async () => {
		const { port } = fakeServer('secret', () => '');
		expect(await withRcon({ port, password: 'secret' }, (run) => run('save-all'))).toBe('');
	});

	it('keeps non-ASCII text intact', async () => {
		const { port } = fakeServer('secret', () => 'Jürgen, 日本語');
		expect(await withRcon({ port, password: 'secret' }, (run) => run('list'))).toBe(
			'Jürgen, 日本語'
		);
	});

	it('refuses a wrong password', async () => {
		const { port } = fakeServer('secret', () => '');
		const error = await withRcon({ port, password: 'nope' }, (run) => run('list')).catch((e) => e);
		expect(error).toBeInstanceOf(RconError);
		expect(error.kind).toBe('auth');
	});

	it('reports a port nothing answers on, quickly', async () => {
		const error = await withRcon({ port: 59999, password: 'x' }, (run) => run('list'), 500).catch(
			(e) => e
		);
		expect(error).toBeInstanceOf(RconError);
		// a closed port refuses at once; some sandboxes drop the packets instead, which times out
		expect(['refused', 'timeout']).toContain(error.kind);
	});

	it('gives up on a server that never answers', async () => {
		const { port } = fakeServer('secret', () => '', { silent: true });
		const error = await withRcon({ port, password: 'secret' }, (run) => run('list'), 200).catch(
			(e) => e
		);
		expect(error).toBeInstanceOf(RconError);
		expect(error.kind).toBe('timeout');
	});

	it('does not pass a command it was never given, and closes when the job throws', async () => {
		const { port, received } = fakeServer('secret', () => '');
		await expect(
			withRcon({ port, password: 'secret' }, async () => {
				throw new Error('job failed');
			})
		).rejects.toThrow('job failed');
		expect(received).toEqual([]);
	});
});
