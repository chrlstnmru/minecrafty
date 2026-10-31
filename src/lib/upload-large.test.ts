import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeInstance } from './../test/instance';
import { serverDir } from './server/instances';
import * as uploads from './server/uploads';
import { discardLarge, uploadLarge, type LargeTarget } from './upload-large';
import { CHUNK_BYTES } from './upload-limits';

// The browser-side sender runs against the real upload sessions, with the network replaced by
// direct calls that can fail on demand.
const net = vi.hoisted(() => ({
	failNext: 0,
	failIndex: -1 as number,
	calls: [] as string[],
	inFlight: 0,
	maxInFlight: 0,
	delayMs: 0,
	stallNext: 0
}));

vi.mock('#lib/files.remote.js', async () => {
	const server = await import('./server/uploads');
	const USER = 1;
	return {
		beginUpload: async (a: { id: number; path: string; name: string; size: number }) => {
			net.calls.push('begin');
			return server.beginUpload({
				instanceId: a.id,
				userId: USER,
				dirRel: a.path,
				relPath: a.name,
				size: a.size
			});
		},
		uploadPiece: async (a: {
			id: number;
			uploadId: string;
			index: number;
			piece: Blob;
			sha256?: string;
		}) => {
			net.calls.push(`piece:${a.index}`);
			net.inFlight++;
			net.maxInFlight = Math.max(net.maxInFlight, net.inFlight);
			try {
				if (net.stallNext > 0) {
					net.stallNext--;
					await new Promise((r) => setTimeout(r, 200));
					throw new Error('stalled request finally died');
				}
				if (net.delayMs) await new Promise((r) => setTimeout(r, net.delayMs));
				if (net.failIndex === a.index) throw new Error('the connection dropped');
				if (net.failNext > 0) {
					net.failNext--;
					throw new Error('the connection dropped');
				}
				return await server.writePiece({
					uploadId: a.uploadId,
					instanceId: a.id,
					userId: USER,
					index: a.index,
					piece: a.piece,
					sha256: a.sha256
				});
			} finally {
				net.inFlight--;
			}
		},
		uploadProgress: async (a: { id: number; uploadId: string }) => {
			net.calls.push('status');
			return server.uploadStatus(a.uploadId, a.id, USER);
		},
		finishUpload: async (a: { id: number; uploadId: string }) => {
			net.calls.push('finish');
			return server.finishUpload(a.uploadId, a.id, USER);
		},
		abortUpload: async (a: { id: number; uploadId: string }) => {
			net.calls.push('abort');
			return server.abortUpload(a.uploadId, a.id, USER);
		}
	};
});

let target: LargeTarget;
let root: string;
const pieceCalls = () => net.calls.filter((c) => c.startsWith('piece:'));
const fileOf = (data: Buffer, name = 'big.bin') => ({
	file: new File([new Uint8Array(data)], name, { lastModified: 1 }),
	path: name
});
const run = (
	item: ReturnType<typeof fileOf>,
	onBytes = vi.fn(),
	signal = new AbortController().signal
) => uploadLarge(item, target, onBytes, signal, 1);

beforeEach(() => {
	uploads.sweepUploads();
	Object.assign(net, {
		failNext: 0,
		failIndex: -1,
		calls: [],
		inFlight: 0,
		maxInFlight: 0,
		delayMs: 0,
		stallNext: 0
	});
	const id = makeInstance().id;
	root = serverDir(id);
	mkdirSync(root, { recursive: true });
	target = { instanceId: id, path: '' };
});

describe('uploadLarge', () => {
	it('sends a piece again when the first attempt never comes back in time', async () => {
		net.stallNext = 1;
		const data = randomBytes(5 * 1024 * 1024); // 2 pieces
		await uploadLarge(fileOf(data), target, vi.fn(), new AbortController().signal, 1, 50);
		expect(readFileSync(join(root, 'big.bin')).equals(data)).toBe(true);
		expect(pieceCalls().length).toBe(3);
	});

	it('sends every piece and the file arrives identical', async () => {
		const data = randomBytes(11 * 1024 * 1024); // 3 pieces
		await run(fileOf(data));
		expect(readFileSync(join(root, 'big.bin')).equals(data)).toBe(true);
		expect(net.calls[0]).toBe('begin');
		expect(net.calls.at(-1)).toBe('finish');
		expect(pieceCalls().sort()).toEqual(['piece:0', 'piece:1', 'piece:2']);
	});

	it('reports growing byte counts that end at the file size', async () => {
		const data = randomBytes(11 * 1024 * 1024);
		const onBytes = vi.fn();
		await run(fileOf(data), onBytes);
		const sent = onBytes.mock.calls.map((c) => c[0] as number);
		expect(sent[0]).toBe(0);
		expect(sent.at(-1)).toBe(data.length);
		expect([...sent].sort((a, b) => a - b)).toEqual(sent);
		expect(onBytes.mock.calls.every((c) => c[1] === data.length)).toBe(true);
	});

	it('keeps at most three pieces in flight', async () => {
		net.delayMs = 15;
		await run(fileOf(randomBytes(9 * CHUNK_BYTES)));
		expect(net.maxInFlight).toBeLessThanOrEqual(3);
		expect(net.maxInFlight).toBeGreaterThan(1);
	});

	it('retries a piece that fails now and then, and still delivers the file', async () => {
		net.failNext = 2;
		const data = randomBytes(11 * 1024 * 1024);
		await run(fileOf(data));
		expect(readFileSync(join(root, 'big.bin')).equals(data)).toBe(true);
		expect(pieceCalls().length).toBe(5); // 3 pieces + 2 retries
	});

	it('gives up after repeated failures and reports the error', async () => {
		net.failIndex = 1;
		await expect(run(fileOf(randomBytes(11 * 1024 * 1024)))).rejects.toThrow(/connection dropped/);
		expect(pieceCalls().filter((c) => c === 'piece:1')).toHaveLength(4); // first try + 3 retries
		expect(existsSync(join(root, 'big.bin'))).toBe(false);
	});

	it('resumes after a failure: only the missing pieces are sent the second time', async () => {
		const data = randomBytes(5 * CHUNK_BYTES + 100); // 6 pieces
		const item = fileOf(data);
		net.failIndex = 3;
		await expect(run(item)).rejects.toThrow();
		const firstRun = pieceCalls().length;
		const delivered = uploads.uploadStatus(
			// the session the failed run left behind
			[...(await sessionIds())][0],
			target.instanceId,
			1
		).have;
		expect(delivered).not.toContain(3);

		net.failIndex = -1;
		net.calls = [];
		await run(item);
		expect(net.calls).toContain('status');
		expect(net.calls).not.toContain('begin'); // the same upload carries on
		expect(pieceCalls().length).toBe(6 - delivered.length);
		for (const i of delivered) expect(net.calls).not.toContain(`piece:${i}`);
		expect(firstRun).toBeGreaterThanOrEqual(delivered.length);
		expect(readFileSync(join(root, 'big.bin')).equals(data)).toBe(true);
	});

	it('starts over if the server has forgotten the upload', async () => {
		const data = randomBytes(5 * CHUNK_BYTES);
		const item = fileOf(data);
		net.failIndex = 2;
		await expect(run(item)).rejects.toThrow();
		uploads.sweepUploads(); // a restart: sessions are gone
		net.failIndex = -1;
		net.calls = [];
		await run(item);
		expect(net.calls).toContain('begin');
		expect(readFileSync(join(root, 'big.bin')).equals(data)).toBe(true);
	});

	it('stops and cleans up when cancelled', async () => {
		net.delayMs = 20;
		const controller = new AbortController();
		const onBytes = vi.fn((sent: number) => sent > 0 && controller.abort());
		await expect(
			uploadLarge(fileOf(randomBytes(12 * CHUNK_BYTES)), target, onBytes, controller.signal, 1)
		).rejects.toThrow(/Cancelled/);
		expect(net.calls).toContain('abort');
		expect(uploads._debug()).toEqual({ sessions: 0, files: 0 });
		expect(existsSync(join(root, 'big.bin'))).toBe(false);
	});

	it('refuses an upload the server will not start, without sending any data', async () => {
		await expect(
			uploadLarge(
				fileOf(randomBytes(10), '../escape.bin'),
				target,
				vi.fn(),
				new AbortController().signal,
				1
			)
		).rejects.toThrow();
		expect(pieceCalls()).toEqual([]);
	});

	it('discardLarge drops a half-sent upload', async () => {
		const item = fileOf(randomBytes(5 * CHUNK_BYTES));
		net.failIndex = 2;
		await expect(run(item)).rejects.toThrow();
		expect(uploads._debug().sessions).toBe(1);
		await discardLarge(item, target);
		expect(uploads._debug().sessions).toBe(0);
	});
});

/** Upload ids of the sessions currently open (found through the temp folder). */
async function sessionIds() {
	const { readdirSync } = await import('node:fs');
	const { join: j } = await import('node:path');
	const { dataDir } = await import('./server/config');
	return readdirSync(j(dataDir, 'tmp', 'uploads')).map((f) => f.replace(/\.part$/, ''));
}
