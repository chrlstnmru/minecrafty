import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { downloadFile } from './download';

const body = randomBytes(3 * 1024 * 1024);
const server = Bun.serve({
	port: 0,
	fetch(req) {
		const path = new URL(req.url).pathname;
		if (path === '/missing') return new Response('no', { status: 404 });
		if (path === '/chunked')
			return new Response(
				new ReadableStream({
					async start(controller) {
						for (let i = 0; i < 6; i++) {
							controller.enqueue(body.subarray(i * 524288, (i + 1) * 524288));
							await Bun.sleep(5);
						}
						controller.close();
					}
				})
			);
		return new Response(body, { headers: { 'content-length': String(body.length) } });
	}
});
afterAll(() => server.stop(true));

const url = (path: string) => `http://localhost:${server.port}${path}`;
const dest = () => join(mkdtempSync(join(tmpdir(), 'dl-')), 'file.bin');
const sha = (algo: string) => createHash(algo).update(body).digest('hex');

describe('downloadFile', () => {
	it('saves the file exactly', async () => {
		const to = dest();
		await downloadFile(to, { url: url('/file') });
		expect(readFileSync(to).equals(body)).toBe(true);
	});

	it('reports growing progress that ends at the whole file', async () => {
		const to = dest();
		const seen: [number, number][] = [];
		await downloadFile(to, { url: url('/file') }, (done, total) => seen.push([done, total]));
		expect(seen.length).toBeGreaterThan(0);
		expect(seen.at(-1)).toEqual([body.length, body.length]);
		const done = seen.map(([d]) => d);
		expect([...done].sort((a, b) => a - b)).toEqual(done);
		expect(readFileSync(to).equals(body)).toBe(true);
	});

	it('does not flood a listener: many chunks, a handful of reports', async () => {
		let calls = 0;
		await downloadFile(dest(), { url: url('/chunked') }, () => calls++);
		expect(calls).toBeLessThan(6);
	});

	it('says the total is unknown when the server does not send a length, then settles on the size', async () => {
		const seen: [number, number][] = [];
		await downloadFile(dest(), { url: url('/chunked') }, (done, total) => seen.push([done, total]));
		expect(seen.at(-1)).toEqual([body.length, body.length]);
		expect(seen.some(([, total]) => total === 0)).toBe(true);
	});

	it('checks the checksum, and leaves nothing behind when it is wrong', async () => {
		const to = dest();
		await downloadFile(to, { url: url('/file'), hash: { algo: 'sha256', value: sha('sha256') } });
		const bad = dest();
		await expect(
			downloadFile(bad, { url: url('/file'), hash: { algo: 'sha1', value: 'deadbeef' } }, () => {})
		).rejects.toThrow(/checksum/);
		expect(existsSync(bad)).toBe(false);
		expect(existsSync(`${bad}.part`)).toBe(false);
	});

	it('refuses an error response and writes nothing', async () => {
		const to = dest();
		await expect(downloadFile(to, { url: url('/missing') })).rejects.toThrow(/404/);
		expect(existsSync(to)).toBe(false);
		expect(existsSync(`${to}.part`)).toBe(false);
	});
});
