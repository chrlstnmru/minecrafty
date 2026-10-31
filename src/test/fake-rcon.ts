// A fake Minecraft RCON server for tests: the same packets, answering with whatever the test says.

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

export function fakeRcon(
	password: string,
	handler: Handler,
	options: { silent?: boolean; port?: number } = {}
) {
	const received: string[] = [];
	const server = Bun.listen<{ buffer: Uint8Array }>({
		hostname: '127.0.0.1',
		port: options.port ?? 0,
		socket: {
			open(socket) {
				socket.data = { buffer: new Uint8Array(0) };
			},
			data(socket, chunk) {
				if (options.silent) return;
				// like Minecraft, which reads once per packet and drops the client when a read holds
				// anything other than exactly one packet (two sent back to back, say)
				const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
				if (chunk.length < 4 || view.getInt32(0, true) !== chunk.length - 4) {
					socket.end();
					return;
				}
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

/** Stops every fake server started since the last call; for afterEach. */
export function stopFakeRcon() {
	for (const server of servers.splice(0)) server.stop(true);
}
