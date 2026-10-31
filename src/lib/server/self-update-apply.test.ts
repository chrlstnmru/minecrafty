import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyUpdate, releaseAsset, type ApplyOptions, type Fetch } from './self-update-apply';

const NEW = new TextEncoder().encode('new program');
const sha = (bytes: Uint8Array) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex');

let dir: string;
let restarts: number;
let urls: string[];
let opts: ApplyOptions;

/** A release on "GitHub" with the program and its checksums; `sums` overrides the checksum file. */
const github =
	(sums = `${sha(NEW)}  minecrafty-linux-x64\n`): Fetch =>
	async (url) => {
		urls.push(String(url));
		if (String(url).endsWith('/SHA256SUMS')) return new Response(sums);
		if (String(url).endsWith('/minecrafty-linux-x64')) return new Response(NEW);
		return new Response('missing', { status: 404 });
	};

const ask = (version: unknown, channel?: string) =>
	writeFileSync(opts.requestFile, JSON.stringify({ version, channel }));
const status = () => JSON.parse(readFileSync(opts.statusFile, 'utf8'));
const program = () => readFileSync(opts.binary, 'utf8');

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'self-update-'));
	restarts = 0;
	urls = [];
	writeFileSync(join(dir, 'minecrafty'), 'old program');
	opts = {
		requestFile: join(dir, 'update-request'),
		statusFile: join(dir, 'update-status.json'),
		binary: join(dir, 'minecrafty'),
		repo: 'owner/repo',
		current: 'v0.1.0',
		asset: 'minecrafty-linux-x64',
		restart: async () => {
			restarts++;
		},
		fetch: github()
	};
});

describe('applyUpdate', () => {
	it('does nothing without a request', async () => {
		expect(await applyUpdate(opts)).toBeNull();
		expect(urls).toEqual([]);
	});

	it('installs a newer release after checking its checksum, then restarts the panel', async () => {
		ask('v0.2.0');
		expect(await applyUpdate(opts)).toMatchObject({ state: 'done', version: 'v0.2.0' });
		expect(program()).toBe('new program');
		expect(restarts).toBe(1);
		expect(existsSync(opts.requestFile)).toBe(false);
		expect(status()).toMatchObject({ state: 'done', version: 'v0.2.0' });
		expect(urls).toContain(
			'https://github.com/owner/repo/releases/download/v0.2.0/minecrafty-linux-x64'
		);
	});

	it('refuses an older or equal version, a pre-release, and anything that is not a tag', async () => {
		for (const version of ['v0.1.0', 'v0.0.9', 'v0.2.0-rc.1', '../../evil', 42]) {
			ask(version);
			expect(await applyUpdate(opts)).toMatchObject({ state: 'failed' });
			expect(existsSync(opts.requestFile)).toBe(false);
		}
		writeFileSync(opts.requestFile, 'not json');
		expect((await applyUpdate(opts))?.message).toMatch(/did not name a release/);
		expect(urls).toEqual([]);
		expect(program()).toBe('old program');
		expect(restarts).toBe(0);
	});

	it('installs a pre-release only when the request is on the pre-release channel', async () => {
		ask('v0.2.0-rc.1', 'release');
		expect(await applyUpdate(opts)).toMatchObject({ state: 'failed' });
		ask('v0.2.0-rc.1', 'prerelease');
		expect(await applyUpdate(opts)).toMatchObject({ state: 'done', version: 'v0.2.0-rc.1' });
		expect(program()).toBe('new program');
	});

	it('never goes back, even on the pre-release channel', async () => {
		opts.current = 'v0.2.0';
		for (const version of ['v0.2.0-rc.5', 'v0.1.9', 'nightly']) {
			ask(version, 'prerelease');
			expect(await applyUpdate(opts)).toMatchObject({ state: 'failed' });
		}
		expect(urls).toEqual([]);
	});

	it('keeps the old program when the download does not match its checksum', async () => {
		opts.fetch = github(`${'0'.repeat(64)}  minecrafty-linux-x64\n`);
		ask('v0.2.0');
		expect((await applyUpdate(opts))?.message).toMatch(/does not match its checksum/);
		expect(program()).toBe('old program');
		expect(restarts).toBe(0);
		expect(status()).toMatchObject({ state: 'failed', version: 'v0.2.0' });
	});

	it('says so when the release has no file for this machine', async () => {
		opts.fetch = github('abc  minecrafty-windows-x64.exe\n');
		ask('v0.2.0');
		expect((await applyUpdate(opts))?.message).toMatch(/not in the release's checksums/);
	});
});

describe('releaseAsset', () => {
	it('names the file the release workflow builds for each machine', () => {
		expect(releaseAsset('linux', 'x64')).toBe('minecrafty-linux-x64');
		expect(releaseAsset('linux', 'arm64')).toBe('minecrafty-linux-arm64');
		expect(releaseAsset('win32', 'x64')).toBe('minecrafty-windows-x64.exe');
		expect(() => releaseAsset('darwin', 'arm64')).toThrow(/No release/);
	});
});
