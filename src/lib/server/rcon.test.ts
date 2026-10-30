import { afterEach, describe, expect, it } from 'vitest';
import { RconError, withRcon } from './rcon';

// A fake Minecraft RCON server: same packets, with whatever the test makes it answer.
type Handler = (command: string) => string;

function packet(id: number, type: number, body: string) {
	const text = new TextEncoder().encode(body);
	const out = new Uint8Array(14 + text.length);
	const view = new DataView(out.buffer);
	view.setInt32(0, 10 + text.length, true);
	view.setInt32(4, id, true);
	view.setInt32(8, type, true);
	out.set(text, 12);
	return out;
}

const servers: { stop(close?: boolean): void }[] = [];

function fakeServer(password: string, handler: Handler, options: { silent?: boolean } = {}) {
	const received: string[] = [];
	const server = Bun.listen<{ buffer: Uint8Array }>({
		hostname: '127.0.0.1',
		port: 0,
		socket: {
			open(socket) {
				socket.data = { buffer: new Uint8Array(0) };
			},
			data(socket, chunk) {
				if (options.silent) return;
				const joined = new Uint8Array(socket.data.buffer.length + chunk.length);
				joined.set(socket.data.buffer);
				joined.set(chunk, socket.data.buffer.length);
				let buffer = joined;
				while (buffer.length >= 4) {
					const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
					const length = view.getInt32(0, true);
					if (buffer.length < 4 + length) break;
					const id = view.getInt32(4, true);
					const type = view.getInt32(8, true);
					const body = new TextDecoder().decode(buffer.subarray(12, 4 + length - 2));
					buffer = buffer.slice(4 + length);
					if (type === 3) {
						socket.write(packet(body === password ? id : -1, 2, ''));
					} else if (type === 2) {
						received.push(body);
						const reply = handler(body);
						// Minecraft cuts a long reply into packets of at most 4096 bytes
						for (let i = 0; i === 0 || i < reply.length; i += 4096)
							socket.write(packet(id, 0, reply.slice(i, i + 4096)));
					} else {
						socket.write(packet(id, 0, `Unknown request ${type.toString(16)}`));
					}
				}
				socket.data.buffer = buffer;
			}
		}
	});
	servers.push(server);
	return { port: server.port, received };
}

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true);
});

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
