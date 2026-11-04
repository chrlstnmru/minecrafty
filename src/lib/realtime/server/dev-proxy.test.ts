import type { AddressInfo } from 'node:net';

import { createServer, request, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { forwardUpgrade, waitForPort } from './dev-proxy';

const servers: Server[] = [];
afterEach(async () => {
	await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

const listen = (server: Server, port = 0) =>
	new Promise<number>((resolve) => {
		servers.push(server);
		server.listen(port, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
	});

/** A port nothing listens on yet. */
const freePort = async () => {
	const probe = createServer();
	const port = await listen(probe);
	await new Promise((r) => probe.close(r));
	servers.splice(servers.indexOf(probe), 1);
	return port;
};

/** Answers an upgrade with 101 and echoes what the client sends, upper-cased, with the path it was asked for. */
const upstream = () => {
	const server = createServer((_, res) => res.end());
	server.on('upgrade', (req, socket) => {
		socket.write(
			`HTTP/1.1 101 Switching Protocols\r\nUpgrade: test\r\nConnection: Upgrade\r\nX-Path: ${req.url}\r\n\r\n`
		);
		socket.on('data', (data) => socket.write(data.toString().toUpperCase()));
	});
	return server;
};

describe('waitForPort', () => {
	it('gives up on a port nothing listens on', async () => {
		expect(await waitForPort(await freePort(), 150, 20)).toBe(false);
	});

	it('answers once something starts listening', async () => {
		const port = await freePort();
		setTimeout(
			() =>
				void listen(
					createServer((_, res) => res.end()),
					port
				),
			100
		);
		expect(await waitForPort(port, 2000, 20)).toBe(true);
	});
});

describe('forwardUpgrade', () => {
	it('holds an upgrade until the socket server is up, then passes it through both ways', async () => {
		const target = await freePort();
		const front = createServer();
		front.on(
			'upgrade',
			(req, socket, head) => void forwardUpgrade(req, socket, head, target, 3000)
		);
		const frontPort = await listen(front);
		// the socket server starts a moment after the tab asks
		setTimeout(() => void listen(upstream(), target), 200);

		const reply = await new Promise<string>((resolve, reject) => {
			const req = request({
				port: frontPort,
				host: '127.0.0.1',
				path: '/_ws?x=1',
				headers: { Connection: 'Upgrade', Upgrade: 'test' }
			});
			req.on('upgrade', (res, socket) => {
				expect(res.statusCode).toBe(101);
				expect(res.headers['x-path']).toBe('/_ws?x=1');
				socket.once('data', (data) => {
					socket.destroy();
					resolve(data.toString());
				});
				socket.write('hello');
			});
			req.on('error', reject);
			req.end();
		});
		expect(reply).toBe('HELLO');
	});

	it('closes the upgrade when the socket server never comes up', async () => {
		const target = await freePort();
		const front = createServer();
		front.on('upgrade', (req, socket, head) => void forwardUpgrade(req, socket, head, target, 150));
		const frontPort = await listen(front);
		const outcome = await new Promise<string>((resolve) => {
			const req = request({
				port: frontPort,
				host: '127.0.0.1',
				path: '/_ws',
				headers: { Connection: 'Upgrade', Upgrade: 'test' }
			});
			req.on('upgrade', () => resolve('upgraded'));
			req.on('error', () => resolve('closed'));
			req.on('close', () => resolve('closed'));
			req.end();
		});
		expect(outcome).toBe('closed');
	});
});
