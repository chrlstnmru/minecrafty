import type { Socket } from 'bun';

// A small client for Minecraft's RCON (the Source RCON protocol): packets of
// [length][id][type][body]\0\0, little-endian, over one TCP connection. The panel opens a
// connection per job, so nothing has to be kept alive or reconnected.

const AUTH = 3;
const COMMAND = 2;
const RESPONSE = 0;
// a type the server does not know answers every packet before it, which is how the end of a
// reply split over several packets is found
const SENTINEL = 200;
const AUTH_ID = 1;

export type RconTarget = { host?: string; port: number; password: string };

export class RconError extends Error {
	constructor(
		message: string,
		readonly kind: 'refused' | 'auth' | 'timeout' | 'closed' | 'protocol'
	) {
		super(message);
	}
}

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

type Reply = { id: number; type: number; body: string };

/** Collects bytes from the socket and hands back whole packets as they complete. */
function reader() {
	let buffer = new Uint8Array(0);
	return (chunk: Uint8Array): Reply[] => {
		const joined = new Uint8Array(buffer.length + chunk.length);
		joined.set(buffer);
		joined.set(chunk, buffer.length);
		buffer = joined;
		const replies: Reply[] = [];
		while (buffer.length >= 4) {
			const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
			const length = view.getInt32(0, true);
			if (length < 10 || length > 8192) throw new RconError('Not an RCON server', 'protocol');
			if (buffer.length < 4 + length) break;
			replies.push({
				id: view.getInt32(4, true),
				type: view.getInt32(8, true),
				body: new TextDecoder().decode(buffer.subarray(12, 4 + length - 2))
			});
			buffer = buffer.slice(4 + length);
		}
		return replies;
	};
}

/**
 * Connects, logs in and runs `job` with a function that sends a command and resolves to the
 * server's reply. The connection is closed afterwards, and the whole thing gives up after `timeoutMs`.
 */
export async function withRcon<T>(
	target: RconTarget,
	job: (run: (command: string) => Promise<string>) => Promise<T>,
	timeoutMs = 5000
): Promise<T> {
	const waiting = new Map<number, (reply: Reply) => void>();
	const parse = reader();
	let failure: RconError | null = null;
	let closed = false;

	const socket = await new Promise<Socket>((resolve, reject) => {
		const refused = new RconError(
			`Nothing is listening for RCON on port ${target.port}`,
			'refused'
		);
		// a host that drops packets never refuses, so connecting needs its own limit
		const giveUp = setTimeout(
			() => reject(new RconError('Could not reach RCON in time', 'timeout')),
			timeoutMs
		);
		Bun.connect({
			hostname: target.host ?? '127.0.0.1',
			port: target.port,
			socket: {
				data(_socket, data) {
					try {
						for (const reply of parse(data)) {
							// a refused password is answered with id -1 instead of the id that was sent
							const wake =
								waiting.get(reply.id) ?? (reply.id === -1 ? waiting.get(AUTH_ID) : undefined);
							wake?.(reply);
						}
					} catch (e) {
						failure = e as RconError;
						for (const wake of waiting.values()) wake({ id: -2, type: -1, body: '' });
					}
				},
				close() {
					closed = true;
					failure ??= new RconError('The server closed the RCON connection', 'closed');
					for (const wake of waiting.values()) wake({ id: -2, type: -1, body: '' });
				},
				error(_socket, error) {
					failure ??= new RconError(error.message, 'closed');
				},
				connectError() {
					clearTimeout(giveUp);
					reject(refused);
				}
			}
		}).then(
			(connected) => {
				clearTimeout(giveUp);
				resolve(connected);
			},
			() => {
				clearTimeout(giveUp);
				reject(refused);
			}
		);
	});

	let next = AUTH_ID + 1;
	const timer = setTimeout(() => {
		failure ??= new RconError('RCON did not answer in time', 'timeout');
		for (const wake of waiting.values()) wake({ id: -2, type: -1, body: '' });
		socket.end();
	}, timeoutMs);

	/** Sends one packet and resolves with the next packet for `id`. */
	const exchange = (id: number, type: number, body: string) =>
		new Promise<Reply>((resolve, reject) => {
			if (failure) return reject(failure);
			waiting.set(id, (reply) => (reply.id === -2 ? reject(failure) : resolve(reply)));
			socket.write(packet(id, type, body));
		});

	try {
		const auth = await exchange(AUTH_ID, AUTH, target.password);
		if (auth.id === -1) throw new RconError('RCON refused the password', 'auth');

		const run = async (command: string) => {
			const id = next++;
			const end = next++;
			const parts: string[] = [];
			const done = new Promise<void>((resolve, reject) => {
				waiting.set(id, (reply) => {
					if (reply.id === -2) return reject(failure);
					if (reply.type === RESPONSE) parts.push(reply.body);
				});
				waiting.set(end, (reply) => (reply.id === -2 ? reject(failure) : resolve()));
			});
			socket.write(packet(id, COMMAND, command));
			socket.write(packet(end, SENTINEL, ''));
			await done;
			waiting.delete(id);
			waiting.delete(end);
			return parts.join('');
		};
		return await job(run);
	} finally {
		clearTimeout(timer);
		if (!closed) socket.end();
	}
}
