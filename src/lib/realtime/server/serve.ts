// Puts the live feeds' socket on a Bun server. adapter-bun gives Bun.serve no WebSocket handler,
// so production wraps Bun.serve before the adapter calls it; dev runs a small server of its own.

import type { Server, WebSocketHandler } from 'bun';

import { SOCKET_PATH } from '#lib/realtime/protocol.js';

import { DEV_SOCKET_PORT } from './dev-port';
import { admit, SocketSession } from './hub';

type Data = { token: string; session?: SocketSession };

const websocket: WebSocketHandler<Data> = {
	open(ws) {
		ws.data.session = new SocketSession(
			{
				send: (text) => void ws.send(text),
				buffered: () => ws.getBufferedAmount(),
				close: (code, reason) => ws.close(code, reason)
			},
			ws.data.token
		);
	},
	message(ws, message) {
		ws.data.session?.message(String(message));
	},
	close(ws) {
		ws.data.session?.close();
	}
};

/** Upgrades a socket request; undefined when it was upgraded, else the response to send. */
function upgrade(request: Request, server: Server<Data>): Response | undefined {
	const admitted = admit(request);
	if (admitted instanceof Response) return admitted;
	if (server.upgrade(request, { data: { token: admitted.token } })) return undefined;
	return new Response('Expected a WebSocket upgrade', { status: 426 });
}

const isSocket = (request: Request) => new URL(request.url).pathname === SOCKET_PATH;

/**
 * Wraps `Bun.serve` so the next server it starts also answers {@link SOCKET_PATH}. Must run before
 * adapter-bun starts its server: `init` in hooks.server.ts runs while the adapter loads the app,
 * before it calls `Bun.serve`.
 */
export function serveSocketsWithBun() {
	const serve = Bun.serve;
	const wrapped = ((options: Bun.Serve.Options<Data>) => {
		Bun.serve = serve;
		const fetch = options.fetch as (request: Request, server: Server<Data>) => unknown;
		return serve({
			...options,
			fetch: (request, server) =>
				isSocket(request) ? upgrade(request, server) : fetch(request, server),
			websocket
		} as Bun.Serve.Options<Data>);
	}) as typeof Bun.serve;
	Bun.serve = wrapped;
}

const DEV_SERVER = Symbol.for('minecrafty.devSocketServer');

/** Dev only: a socket server on {@link DEV_SOCKET_PORT}, which Vite's proxy forwards to. */
export function serveSocketsForDev() {
	const global = globalThis as { [DEV_SERVER]?: Server<Data> };
	// the dev server reloads server code without restarting the process; drop the old socket server
	void global[DEV_SERVER]?.stop(true);
	global[DEV_SERVER] = Bun.serve<Data>({
		hostname: '127.0.0.1',
		port: DEV_SOCKET_PORT,
		fetch: (request, server) =>
			isSocket(request) ? upgrade(request, server) : new Response('Not found', { status: 404 }),
		websocket
	});
}
