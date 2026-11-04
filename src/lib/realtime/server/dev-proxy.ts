// Dev only: forwards the live feeds' socket from Vite to the dev socket server (serve.ts), and gets
// that server started without waiting for a browser.

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Plugin } from 'vite';

import { connect } from 'node:net';

const HOST = '127.0.0.1';

/**
 * Whether an HTTP server answers on the port right now. A bare TCP connect is not enough: under WSL2
 * a connection to a port nothing listens on can still report itself connected.
 */
async function accepting(port: number) {
	try {
		await fetch(`http://${HOST}:${port}/`, { method: 'HEAD', signal: AbortSignal.timeout(1000) });
		return true;
	} catch {
		return false;
	}
}

/** True once a server answers on the port; false if none has within `timeoutMs`. */
export async function waitForPort(port: number, timeoutMs = 15_000, intervalMs = 100) {
	const end = Date.now() + timeoutMs;
	for (;;) {
		if (await accepting(port)) return true;
		if (Date.now() >= end) return false;
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
}

/**
 * Passes a WebSocket upgrade through to the port, byte for byte, once the port is up. A tab that
 * reconnects while the dev server is still starting waits here instead of being refused.
 */
export async function forwardUpgrade(
	req: IncomingMessage,
	socket: Duplex,
	head: Buffer,
	port: number,
	timeoutMs?: number
) {
	socket.on('error', () => socket.destroy());
	if (!(await waitForPort(port, timeoutMs)) || socket.destroyed) {
		socket.destroy();
		return;
	}
	const upstream = connect(port, HOST);
	upstream.on('error', () => socket.destroy());
	upstream.on('close', () => socket.destroy());
	socket.on('close', () => upstream.destroy());
	const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
	for (let i = 0; i < req.rawHeaders.length; i += 2)
		lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
	upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
	if (head.length) upstream.write(head);
	upstream.pipe(socket);
	socket.pipe(upstream);
}

/**
 * Forwards `path`'s WebSocket to the dev socket server on `port`, and makes one request as soon as
 * Vite listens: SvelteKit runs `init`, which starts that server, only on the first request.
 */
export function devSocketProxy(path: string, port: number): Plugin {
	return {
		name: 'minecrafty:dev-socket',
		apply: 'serve',
		configureServer(server) {
			const http = server.httpServer;
			if (!http) return;
			http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
				if (new URL(req.url ?? '/', 'http://localhost').pathname !== path) return;
				void forwardUpgrade(req, socket, head, port);
			});
			http.once('listening', () => {
				const address = http.address();
				if (!address || typeof address === 'string') return;
				const host = ['::', '0.0.0.0'].includes(address.address) ? HOST : address.address;
				const origin = `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`;
				void fetch(`${origin}/login`, { method: 'HEAD' }).catch(() => undefined);
			});
		}
	};
}
