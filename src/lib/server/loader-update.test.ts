import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeInstance } from '#test/instance.js';
import { db } from './db';
import { instances } from './db/schema';

// The version services and the installer are replaced: what matters here is what the update does
// to the server folder and the database, not downloading real loaders.
const fake = vi.hoisted(() => ({
	running: false,
	builds: {} as Record<string, string | null | undefined>,
	lists: {} as Record<string, string[]>,
	known: new Set<string>(),
	install: null as null | ((dir: string, mc: string, build?: string) => void),
	seen: [] as { dir: string; mc: string; build?: string }[]
}));

vi.mock('./runner-client', () => ({
	status: async () =>
		fake.running ? { state: 'running', pid: 1, startedAt: 0, exitCode: null } : null,
	send: async () => true,
	subscribe: async () => null
}));

vi.mock('./java', () => ({
	ensureJava: async () => '/fake/java',
	requiredJavaMajor: async (mc: string) => (mc.startsWith('1.21') ? 21 : 17),
	JAVA_MAJORS: [8, 17, 21, 25]
}));

vi.mock('./loaders', async (original) => ({
	...(await original<typeof import('./loaders')>()),
	isKnownVersion: async (_loader: string, mc: string) => fake.known.has(mc),
	getMinecraftVersions: async () => [...fake.known],
	latestBuild: async (_loader: string, mc: string) => fake.builds[mc],
	loaderBuilds: async (_loader: string, mc: string) => fake.lists[mc] ?? [],
	launchArgs: () => ['-jar', 'server.jar', 'nogui'],
	installServer: async (o: { serverDir: string; mc: string; build?: string }) => {
		fake.seen.push({ dir: o.serverDir, mc: o.mc, build: o.build });
		if (!fake.install) throw new Error('no installer in this test');
		fake.install(o.serverDir, o.mc, o.build);
	}
}));

const U = await import('./loader-update');
const { lastOutcome } = await import('./update-outcome');
const { listBackups } = await import('./backups');
const { getInstance, instanceDir, serverDir } = await import('./instances');

let id: number;
let root: string;
const put = (rel: string, content = 'x') => {
	mkdirSync(join(root, rel, '..'), { recursive: true });
	writeFileSync(join(root, rel), content);
};
const state = () => getInstance(id)!;

beforeEach(() => {
	Object.assign(fake, {
		running: false,
		builds: { '1.21.4': '130', '1.21.5': '140', '1.20.1': '20' },
		lists: { '1.21.4': ['130', '125', '120'], '1.21.5': ['140', '135'] },
		known: new Set(['1.21.5', '1.21.4', '1.20.1']),
		install: (dir: string, mc: string, build?: string) =>
			writeFileSync(join(dir, 'server.jar'), `${mc}-${build}`),
		seen: []
	});
	id = makeInstance({ loader: 'paper', mcVersion: '1.21.4', loaderVersion: '120' }).id;
	root = serverDir(id);
	put('server.jar', '1.21.4-120');
	put('world/level.dat', 'level');
	put('server.properties', 'motd=hi\n');
	db.update(instances).set({ loaderVersion: '120' }).where(eq(instances.id, id)).run();
});

const run = async (mcVersion: string, backup = false) => {
	const started = await U.startLoaderUpdate(id, { mcVersion, backup });
	await started.finished;
	return started;
};

describe('startLoaderUpdate', () => {
	it('installs a build picked by hand, an older one too', async () => {
		const started = await U.startLoaderUpdate(id, {
			mcVersion: '1.21.4',
			build: '125',
			backup: false
		});
		await started.finished;
		expect(fake.seen[0]).toMatchObject({ mc: '1.21.4', build: '125' });
		expect(state()).toMatchObject({ loaderVersion: '125', installState: 'ready' });
		expect(await U.buildsFor(id, '1.21.5')).toEqual(['140', '135']);
	});

	it('refuses a build the loader does not have, or the one it already runs', async () => {
		await expect(
			U.startLoaderUpdate(id, { mcVersion: '1.21.5', build: '130', backup: false })
		).rejects.toThrow('paper has no build 130 for Minecraft 1.21.5');
		await expect(
			U.startLoaderUpdate(id, { mcVersion: '1.21.4', build: '120', backup: false })
		).rejects.toThrow(/Already up to date/);
		expect(fake.seen).toEqual([]);
	});

	it('replaces the server jar with the newest build and records it', async () => {
		const started = await run('1.21.4');
		expect(started.kind).toBe('build');
		expect(readFileSync(join(root, 'server.jar'), 'utf8')).toBe('1.21.4-130');
		expect(state()).toMatchObject({
			mcVersion: '1.21.4',
			loaderVersion: '130',
			installState: 'ready'
		});
		expect(lastOutcome(id)).toMatchObject({ ok: true });
		expect(existsSync(`${root}.updating`)).toBe(false);
	});

	it('leaves the world and settings alone when the Minecraft version changes', async () => {
		const started = await run('1.21.5');
		expect(started.kind).toBe('upgrade');
		expect(state()).toMatchObject({ mcVersion: '1.21.5', loaderVersion: '140' });
		expect(readFileSync(join(root, 'world/level.dat'), 'utf8')).toBe('level');
		expect(readFileSync(join(root, 'server.properties'), 'utf8')).toBe('motd=hi\n');
		expect(JSON.parse(readFileSync(join(instanceDir(id), 'instance.json'), 'utf8'))).toMatchObject({
			mcVersion: '1.21.5'
		});
	});

	it('calls going to an older Minecraft version a downgrade', async () => {
		expect((await run('1.20.1')).kind).toBe('downgrade');
	});

	it('installs beside the server, never into it', async () => {
		await run('1.21.5');
		expect(fake.seen).toHaveLength(1);
		expect(fake.seen[0].dir).toBe(`${root}.updating`);
		expect(fake.seen[0]).toMatchObject({ mc: '1.21.5', build: '140' });
	});

	it('backs up first when asked, and keeps that backup out of retention', async () => {
		await run('1.21.5', true);
		const [backup] = listBackups(id);
		expect(backup).toMatchObject({ kind: 'before-update' });
		expect(backup.note).toContain('1.21.5');
	});

	it('makes no backup when not asked', async () => {
		await run('1.21.5', false);
		expect(listBackups(id)).toEqual([]);
	});

	it('refuses when already on the newest build', async () => {
		db.update(instances).set({ loaderVersion: '130' }).where(eq(instances.id, id)).run();
		await expect(U.startLoaderUpdate(id, { mcVersion: '1.21.4', backup: false })).rejects.toThrow(
			/Already up to date/
		);
	});

	it('refuses a running server, an unknown version and a version with no build', async () => {
		fake.running = true;
		await expect(U.startLoaderUpdate(id, { mcVersion: '1.21.5', backup: false })).rejects.toThrow(
			/Stop the server/
		);
		fake.running = false;
		await expect(U.startLoaderUpdate(id, { mcVersion: '9.9.9', backup: false })).rejects.toThrow(
			/does not support/
		);
		fake.builds['1.21.5'] = undefined;
		await expect(U.startLoaderUpdate(id, { mcVersion: '1.21.5', backup: false })).rejects.toThrow(
			/no paper build/
		);
		expect(state().installState).toBe('ready');
	});

	it('refuses a second update while one runs', async () => {
		const first = await U.startLoaderUpdate(id, { mcVersion: '1.21.5', backup: false });
		await expect(U.startLoaderUpdate(id, { mcVersion: '1.20.1', backup: false })).rejects.toThrow(
			/Wait for the install/
		);
		await first.finished;
	});

	it('shows as installing while it runs and ready afterwards', async () => {
		const started = await U.startLoaderUpdate(id, { mcVersion: '1.21.5', backup: false });
		expect(state().installState).toBe('installing');
		await started.finished;
		expect(state().installState).toBe('ready');
	});
});

describe('a failing install', () => {
	it('leaves the old server and the old version exactly as they were', async () => {
		fake.install = () => {
			throw new Error('installer exploded');
		};
		await run('1.21.5');
		expect(readFileSync(join(root, 'server.jar'), 'utf8')).toBe('1.21.4-120');
		expect(state()).toMatchObject({
			mcVersion: '1.21.4',
			loaderVersion: '120',
			installState: 'ready'
		});
		expect(lastOutcome(id)).toMatchObject({ ok: false, message: 'installer exploded' });
		expect(existsSync(`${root}.updating`)).toBe(false);
	});

	it('lets a new update start afterwards', async () => {
		fake.install = () => {
			throw new Error('boom');
		};
		await run('1.21.5');
		fake.install = (dir, mc, build) => writeFileSync(join(dir, 'server.jar'), `${mc}-${build}`);
		await run('1.21.5');
		expect(state().mcVersion).toBe('1.21.5');
	});
});

describe('loaders that install many files', () => {
	beforeEach(() => {
		db.update(instances)
			.set({ loader: 'neoforge', mcVersion: '1.21.4', loaderVersion: '21.4.100' })
			.where(eq(instances.id, id))
			.run();
		put('libraries/net/neoforged/neoforge/21.4.100/unix_args.txt', 'old');
		put('run.sh', 'old run');
		put('user_jvm_args.txt', 'my flags');
		put('mods/a.jar', 'mod');
		fake.builds['1.21.5'] = '21.5.7';
		fake.install = (dir) => {
			mkdirSync(join(dir, 'libraries/net/neoforged/neoforge/21.5.7'), { recursive: true });
			writeFileSync(join(dir, 'libraries/net/neoforged/neoforge/21.5.7/unix_args.txt'), 'new');
			writeFileSync(join(dir, 'run.sh'), 'new run');
			writeFileSync(join(dir, 'user_jvm_args.txt'), 'default flags');
		};
	});

	it('removes the old libraries so they cannot be picked up, and keeps user files', async () => {
		await run('1.21.5');
		expect(existsSync(join(root, 'libraries/net/neoforged/neoforge/21.4.100'))).toBe(false);
		expect(
			readFileSync(join(root, 'libraries/net/neoforged/neoforge/21.5.7/unix_args.txt'), 'utf8')
		).toBe('new');
		expect(readFileSync(join(root, 'run.sh'), 'utf8')).toBe('new run');
		expect(readFileSync(join(root, 'user_jvm_args.txt'), 'utf8')).toBe('my flags');
		expect(readFileSync(join(root, 'mods/a.jar'), 'utf8')).toBe('mod');
		expect(readdirSync(root)).not.toContain('server.jar.part');
	});
});

describe('Java choice', () => {
	it('goes back to automatic when the chosen Java is too old for the new version', async () => {
		db.update(instances).set({ javaMajor: 17 }).where(eq(instances.id, id)).run();
		await run('1.21.5');
		expect(state().javaMajor).toBeNull();
		expect(lastOutcome(id)?.message).toContain('Java is now chosen automatically');
	});

	it('keeps a chosen Java that is new enough', async () => {
		db.update(instances).set({ javaMajor: 25 }).where(eq(instances.id, id)).run();
		await run('1.21.5');
		expect(state().javaMajor).toBe(25);
	});
});

describe('loaderInfo', () => {
	it('reports the current build, the newest one and the versions on offer', async () => {
		const info = await U.loaderInfo(id);
		expect(info).toMatchObject({
			mcVersion: '1.21.4',
			loaderVersion: '120',
			latest: '130',
			error: null
		});
		expect(info.versions).toContain('1.21.5');
	});
});
