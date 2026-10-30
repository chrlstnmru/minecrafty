import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeInstance } from '#test/instance.js';
import { db } from './db';
import { instances } from './db/schema';

// The installer is replaced: a test decides when it finishes, what it reports, and whether it fails.
const install = vi.hoisted(() => ({
	release: null as null | (() => void),
	fail: null as string | null,
	calls: [] as { dir: string; mc: string; loader: string }[],
	steps: [] as [string, number?, number?][]
}));

vi.mock('./loaders', async (original) => ({
	...(await original<typeof import('./loaders')>()),
	installServer: async (o: {
		serverDir: string;
		mc: string;
		loader: string;
		report?: (step: 'downloading' | 'installing', done?: number, total?: number) => void;
	}) => {
		install.calls.push({ dir: o.serverDir, mc: o.mc, loader: o.loader });
		for (const [step, done, total] of install.steps)
			o.report?.(step as 'downloading' | 'installing', done, total);
		// wait until the test lets it go, so "while it installs" can be looked at
		await new Promise<void>((resolve) => (install.release = resolve));
		if (install.fail) throw new Error(install.fail);
		writeFileSync(join(o.serverDir, 'server.jar'), 'jar');
	}
}));

const I = await import('./instances');
const { getProgress } = await import('./install-progress');

type NewInstance = import('./instances').NewInstance;
// each instance gets the next port; a random one now and then repeats and fails the UNIQUE check
let port = 27000;
const input = (over: Partial<NewInstance> = {}): NewInstance => ({
	name: 'New server',
	loader: 'paper',
	mcVersion: '1.21.4',
	loaderVersion: '120',
	port: port++,
	ramMinMb: 512,
	ramMaxMb: 1024,
	jvmArgs: '',
	autoStart: false,
	eulaAccepted: true,
	...over
});
const state = (id: number) => I.getInstance(id)!;
const tick = () => Bun.sleep(5);

beforeEach(() => {
	Object.assign(install, { release: null, fail: null, calls: [], steps: [] });
});

describe('createInstance', () => {
	it('returns at once with the instance marked as installing, before the server is downloaded', async () => {
		const { row, finished } = I.createInstance(input());
		expect(row.installState).toBe('installing');
		expect(state(row.id).installState).toBe('installing');
		expect(getProgress(row.id)).toMatchObject({ label: 'Starting' });
		await tick();
		expect(existsSync(join(I.serverDir(row.id), 'server.jar'))).toBe(false);
		install.release!();
		await finished;
	});

	it('becomes ready, with its files and instance.json, once the install is done', async () => {
		const { row, finished } = I.createInstance(input({ mcVersion: '1.21.5' }));
		await tick();
		install.release!();
		await finished;
		expect(state(row.id)).toMatchObject({ installState: 'ready', installMessage: null });
		expect(readFileSync(join(I.serverDir(row.id), 'server.jar'), 'utf8')).toBe('jar');
		expect(
			JSON.parse(readFileSync(join(I.instanceDir(row.id), 'instance.json'), 'utf8'))
		).toMatchObject({
			mcVersion: '1.21.5'
		});
		expect(getProgress(row.id)).toBeNull();
	});

	it('shows download progress in bytes while it runs, and the installer step after', async () => {
		install.steps = [['downloading', 1000, 5000]];
		const { row, finished } = I.createInstance(input());
		await tick();
		expect(getProgress(row.id)).toEqual({
			label: 'Downloading the server',
			done: 1000,
			total: 5000,
			bytes: true
		});
		install.release!();
		await finished;
	});

	it('cannot be started while it installs', async () => {
		const { row, finished } = I.createInstance(input());
		await tick();
		await expect(I.startInstance(row.id)).rejects.toThrow(/Still installing/);
		install.release!();
		await finished;
	});

	it('fails with the reason, keeps the instance, and clears the progress', async () => {
		install.fail = 'Download failed (503)';
		const { row, finished } = I.createInstance(input());
		await tick();
		install.release!();
		await finished;
		expect(state(row.id)).toMatchObject({
			installState: 'failed',
			installMessage: 'Download failed (503)'
		});
		expect(getProgress(row.id)).toBeNull();
	});

	it('does not leave other instances alone installing when one fails', async () => {
		const other = makeInstance().id;
		install.fail = 'boom';
		const { finished } = I.createInstance(input());
		await tick();
		install.release!();
		await finished;
		expect(state(other).installState).toBe('ready');
	});
});

describe('retryInstall', () => {
	async function failed() {
		install.fail = 'Download failed (503)';
		const { row, finished } = I.createInstance(input());
		await tick();
		install.release!();
		await finished;
		install.fail = null;
		return row;
	}

	it('installs again from a clean folder, and the instance becomes ready', async () => {
		const row = await failed();
		writeFileSync(join(I.serverDir(row.id), 'half-downloaded.part'), 'junk');
		const retry = I.retryInstall(row.id);
		expect(retry.row.installState).toBe('installing');
		await tick();
		install.release!();
		await retry.finished;
		expect(state(row.id)).toMatchObject({ installState: 'ready', installMessage: null });
		expect(existsSync(join(I.serverDir(row.id), 'half-downloaded.part'))).toBe(false);
		expect(existsSync(join(I.serverDir(row.id), 'server.jar'))).toBe(true);
	});

	it('refuses an instance that did not fail', async () => {
		expect(() => I.retryInstall(makeInstance().id)).toThrow(/Nothing failed/);
		expect(() => I.retryInstall(999_999)).toThrow(/not found/);
	});

	it('refuses a modpack server, which needs its pack and not just the loader', async () => {
		const row = await failed();
		db.update(instances).set({ packProjectId: 'PACK' }).where(eq(instances.id, row.id)).run();
		expect(() => I.retryInstall(row.id)).toThrow(/modpack/i);
	});

	it('refuses a server that was set up before, so a failed update never erases its world', async () => {
		const { row, finished } = I.createInstance(input());
		await tick();
		install.release!();
		await finished;
		writeFileSync(join(I.serverDir(row.id), 'level.dat'), 'world');
		db.update(instances).set({ installState: 'failed' }).where(eq(instances.id, row.id)).run();
		expect(() => I.retryInstall(row.id)).toThrow(/erase its world/);
		expect(existsSync(join(I.serverDir(row.id), 'level.dat'))).toBe(true);
	});

	it('can fail again and be retried again', async () => {
		const row = await failed();
		install.fail = 'still down';
		const second = I.retryInstall(row.id);
		await tick();
		install.release!();
		await second.finished;
		expect(state(row.id).installMessage).toBe('still down');
		install.fail = null;
		const third = I.retryInstall(row.id);
		await tick();
		install.release!();
		await third.finished;
		expect(state(row.id).installState).toBe('ready');
	});
});
