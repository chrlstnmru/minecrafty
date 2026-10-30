import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeInstance } from '#test/instance.js';
import { db } from './db';
import { installedMods, instances } from './db/schema';
import { Zip } from './zip';
import { zipStream, type ZipEntry } from './zip-writer';

// Modrinth, the downloads, the runner and the installer are replaced: what matters is what an
// update does to the server folder, the Mods tab and the instance, given two versions of a pack.
const fake = vi.hoisted(() => ({
	running: false,
	content: new Map<string, string>(),
	failUrl: null as string | null,
	known: new Map<string, { project_id: string; id: string; version_number: string }>(),
	installs: [] as { dir: string; mc: string; build?: string }[],
	packs: new Map<string, unknown>()
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
	launchArgs: () => ['-jar', 'server.jar', 'nogui'],
	installServer: async (o: { serverDir: string; mc: string; build?: string }) => {
		fake.installs.push({ dir: o.serverDir, mc: o.mc, build: o.build });
		writeFileSync(join(o.serverDir, 'server.jar'), `${o.mc}-${o.build}`);
	}
}));

vi.mock('./download', () => ({
	downloadFile: async (dest: string, { url }: { url: string }) => {
		if (url === fake.failUrl) throw new Error('Download failed (500)');
		const content = fake.content.get(url);
		if (content === undefined) throw new Error(`no fake content for ${url}`);
		writeFileSync(dest, content);
	}
}));

vi.mock('./modrinth', async (original) => ({
	...(await original<typeof import('./modrinth')>()),
	versionsByHashes: async (hashes: string[]) =>
		Object.fromEntries(hashes.filter((h) => fake.known.has(h)).map((h) => [h, fake.known.get(h)])),
	getProjects: async () => [],
	listVersions: async () => [
		{
			id: 'V2',
			version_number: '2.0',
			version_type: 'release',
			date_published: '2025-02-01',
			game_versions: ['1.21.4'],
			loaders: ['fabric']
		},
		{
			id: 'V1',
			version_number: '1.0',
			version_type: 'release',
			date_published: '2025-01-01',
			game_versions: ['1.21.4'],
			loaders: ['fabric']
		}
	]
}));

vi.mock('./modpacks', async (original) => ({
	...(await original<typeof import('./modpacks')>()),
	loadModpack: async (versionId: string) => {
		const pack = fake.packs.get(versionId);
		if (!pack) throw new Error(`no pack ${versionId}`);
		return pack;
	}
}));

const U = await import('./modpack-update');
const { writeManifest, readManifest } = await import('./modpack-manifest');
const { lastOutcome } = await import('./update-outcome');
const { listBackups } = await import('./backups');
const { getInstance, serverDir } = await import('./instances');
type LoadedPack = Awaited<ReturnType<typeof import('./modpacks').loadModpack>>;

const sha1 = (text: string) => createHash('sha1').update(text).digest('hex');
const sha512 = (text: string) => createHash('sha512').update(text).digest('hex');

type PackSpec = {
	versionId: string;
	versionNumber: string;
	files: Record<string, string>;
	overrides?: Record<string, string>;
	mc?: string;
	loaderVersion?: string;
	loader?: 'fabric' | 'forge';
	projectId?: string;
};

async function makePack(spec: PackSpec): Promise<LoadedPack> {
	const work = mkdtempSync(join(tmpdir(), 'pack-'));
	const entries: ZipEntry[] = [];
	const overrides = { 'readme.txt': 'hello', ...spec.overrides };
	for (const [path, content] of Object.entries(overrides)) {
		writeFileSync(join(work, path.replaceAll('/', '_')), content);
		entries.push({
			kind: 'file',
			name: `overrides/${path}`,
			path: join(work, path.replaceAll('/', '_')),
			modified: new Date()
		});
	}
	const bytes = new Uint8Array(await new Response(zipStream(entries)).arrayBuffer());

	const files = Object.entries(spec.files).map(([path, content]) => {
		const url = `https://cdn.modrinth.com/data/${spec.versionId}/${path}`;
		fake.content.set(url, content);
		fake.known.set(sha512(content), {
			project_id: `P-${path}`,
			id: `${spec.versionId}-${path}`,
			version_number: spec.versionNumber
		});
		return {
			path,
			hashes: { sha1: sha1(content), sha512: sha512(content) },
			downloads: [url],
			fileSize: content.length,
			env: { server: 'required' }
		};
	});
	const pack = {
		zip: new Zip(bytes),
		index: {
			formatVersion: 1,
			game: 'minecraft',
			name: 'Test Pack',
			versionId: spec.versionNumber,
			files,
			dependencies: {}
		},
		summary: {
			projectId: spec.projectId ?? 'PACK',
			versionId: spec.versionId,
			name: 'Test Pack',
			summary: '',
			versionNumber: spec.versionNumber,
			mcVersion: spec.mc ?? '1.21.4',
			loader: spec.loader ?? 'fabric',
			loaderVersion: spec.loaderVersion ?? '0.16.0',
			files: files.length,
			clientOnly: 0,
			downloadBytes: 0,
			overrides: Object.keys(overrides).length
		}
	} as unknown as LoadedPack;
	fake.packs.set(spec.versionId, pack);
	return pack;
}

let id: number;
let root: string;
const put = (rel: string, content: string) => {
	mkdirSync(join(root, rel, '..'), { recursive: true });
	writeFileSync(join(root, rel), content);
};
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const state = () => getInstance(id)!;
const tracked = () =>
	db
		.select()
		.from(installedMods)
		.where(eq(installedMods.instanceId, id))
		.all()
		.map((r) => r.file)
		.sort();

/** Installs v1 the way an import would have: files on disk, the manifest and the origin columns. */
async function installV1(files: Record<string, string>, overrides: Record<string, string> = {}) {
	for (const [path, content] of Object.entries(files)) put(path, content);
	for (const [path, content] of Object.entries(overrides)) put(path, content);
	writeManifest(id, {
		files: Object.fromEntries(Object.entries(files).map(([p, c]) => [p, sha1(c)])),
		overrides: Object.fromEntries(
			Object.entries({ 'readme.txt': 'hello', ...overrides }).map(([p, c]) => [p, sha1(c)])
		)
	});
	put('readme.txt', 'hello');
}

const run = async (
	versionId: string,
	options: { backup?: boolean; replaceConfigs?: boolean } = {}
) => {
	const started = await U.startModpackUpdate(id, {
		versionId,
		backup: options.backup ?? false,
		replaceConfigs: options.replaceConfigs ?? false
	});
	await started.finished;
	return started;
};

beforeEach(() => {
	Object.assign(fake, {
		running: false,
		failUrl: null,
		installs: []
	});
	fake.content.clear();
	fake.known.clear();
	fake.packs.clear();
	id = makeInstance({ loader: 'fabric', mcVersion: '1.21.4', loaderVersion: '0.16.0' }).id;
	root = serverDir(id);
	mkdirSync(root, { recursive: true });
	db.update(instances)
		.set({
			packProjectId: 'PACK',
			packVersionId: 'V1',
			packVersionNumber: '1.0',
			packName: 'Test Pack'
		})
		.where(eq(instances.id, id))
		.run();
	put('world/level.dat', 'level');
});

describe('updating the files', () => {
	it('adds, replaces and removes pack mods and leaves the player files and the world alone', async () => {
		await installV1({ 'mods/a.jar': 'a1', 'mods/b.jar': 'b1', 'mods/gone.jar': 'gone' });
		put('mods/mine.jar', 'user mod');
		await makePack({
			versionId: 'V2',
			versionNumber: '2.0',
			files: { 'mods/a.jar': 'a2', 'mods/b.jar': 'b1', 'mods/new.jar': 'new' }
		});

		await run('V2');

		expect(read('mods/a.jar')).toBe('a2');
		expect(read('mods/b.jar')).toBe('b1');
		expect(read('mods/new.jar')).toBe('new');
		expect(existsSync(join(root, 'mods/gone.jar'))).toBe(false);
		expect(read('mods/mine.jar')).toBe('user mod');
		expect(read('world/level.dat')).toBe('level');
		expect(existsSync(`${root}.updating`)).toBe(false);
		expect(lastOutcome(id)).toMatchObject({ ok: true });
	});

	it('records the new version on the instance and in the manifest', async () => {
		await installV1({ 'mods/a.jar': 'a1' });
		await makePack({ versionId: 'V2', versionNumber: '2.0', files: { 'mods/a.jar': 'a2' } });
		await run('V2');
		expect(state()).toMatchObject({
			packVersionId: 'V2',
			packVersionNumber: '2.0',
			installState: 'ready'
		});
		expect(readManifest(id)?.files).toEqual({ 'mods/a.jar': sha1('a2') });
	});

	it('keeps the Mods tab in step with the files', async () => {
		await installV1({ 'mods/a.jar': 'a1', 'mods/gone.jar': 'gone' });
		db.insert(installedMods)
			.values([
				{
					instanceId: id,
					source: 'modrinth',
					projectId: 'P-a',
					versionId: 'o',
					title: 'a',
					versionNumber: '1',
					file: 'mods/a.jar'
				},
				{
					instanceId: id,
					source: 'modrinth',
					projectId: 'P-gone',
					versionId: 'o',
					title: 'g',
					versionNumber: '1',
					file: 'mods/gone.jar'
				}
			])
			.run();
		await makePack({
			versionId: 'V2',
			versionNumber: '2.0',
			files: { 'mods/a.jar': 'a2', 'mods/new.jar': 'new' }
		});
		await run('V2');
		expect(tracked()).toEqual(['mods/a.jar', 'mods/new.jar']);
	});

	it('shows as installing while it runs and ready afterwards', async () => {
		await installV1({ 'mods/a.jar': 'a1' });
		await makePack({ versionId: 'V2', versionNumber: '2.0', files: { 'mods/a.jar': 'a2' } });
		const started = await U.startModpackUpdate(id, {
			versionId: 'V2',
			backup: false,
			replaceConfigs: false
		});
		expect(state().installState).toBe('installing');
		await started.finished;
		expect(state().installState).toBe('ready');
	});
});

describe('changes the player made', () => {
	it('keeps a mod the player changed and says so', async () => {
		await installV1({ 'mods/a.jar': 'a1', 'mods/b.jar': 'b1' });
		put('mods/a.jar', 'my own build of a');
		await makePack({
			versionId: 'V2',
			versionNumber: '2.0',
			files: { 'mods/a.jar': 'a2', 'mods/b.jar': 'b2' }
		});
		await run('V2');
		expect(read('mods/a.jar')).toBe('my own build of a');
		expect(read('mods/b.jar')).toBe('b2');
		expect(lastOutcome(id)?.details?.join('\n')).toContain('mods/a.jar');
	});

	it('does not bring back a mod the player deleted', async () => {
		await installV1({ 'mods/a.jar': 'a1', 'mods/b.jar': 'b1' });
		rmSync(join(root, 'mods/a.jar'));
		await makePack({
			versionId: 'V2',
			versionNumber: '2.0',
			files: { 'mods/a.jar': 'a2', 'mods/b.jar': 'b1' }
		});
		await run('V2');
		expect(existsSync(join(root, 'mods/a.jar'))).toBe(false);
	});

	it('keeps a mod the player disabled disabled, with its new version', async () => {
		await installV1({ 'mods/a.jar': 'a1' });
		db.insert(installedMods)
			.values({
				instanceId: id,
				source: 'modrinth',
				projectId: 'P-mods/a.jar',
				versionId: 'o',
				title: 'a',
				versionNumber: '1',
				file: 'mods/a.jar.disabled'
			})
			.run();
		writeFileSync(join(root, 'mods/a.jar.disabled'), 'a1');
		rmSync(join(root, 'mods/a.jar'));
		await makePack({ versionId: 'V2', versionNumber: '2.0', files: { 'mods/a.jar': 'a2' } });
		await run('V2');
		expect(existsSync(join(root, 'mods/a.jar'))).toBe(false);
		expect(read('mods/a.jar.disabled')).toBe('a2');
		expect(tracked()).toEqual(['mods/a.jar.disabled']);
	});

	it('removes a dropped mod even when the player had disabled it', async () => {
		await installV1({ 'mods/a.jar': 'a1' });
		writeFileSync(join(root, 'mods/a.jar.disabled'), 'a1');
		rmSync(join(root, 'mods/a.jar'));
		await makePack({ versionId: 'V2', versionNumber: '2.0', files: {} });
		await run('V2');
		expect(readdirSync(join(root, 'mods'))).toEqual([]);
	});

	it('does not overwrite a file of the same name the player put there', async () => {
		await installV1({});
		put('mods/new.jar', 'the player had this');
		await makePack({
			versionId: 'V2',
			versionNumber: '2.0',
			files: { 'mods/new.jar': 'from pack' }
		});
		await run('V2');
		expect(read('mods/new.jar')).toBe('the player had this');
	});
});

describe('config files', () => {
	beforeEach(async () => {
		await installV1(
			{},
			{ 'config/untouched.toml': 'v1', 'config/edited.toml': 'v1', 'config/dropped.toml': 'v1' }
		);
		put('config/edited.toml', 'player edit');
	});

	const v2 = () =>
		makePack({
			versionId: 'V2',
			versionNumber: '2.0',
			files: {},
			overrides: {
				'config/untouched.toml': 'v2',
				'config/edited.toml': 'v2',
				'config/added.toml': 'new'
			}
		});

	it('updates configs the player never touched, adds new ones and removes dropped ones', async () => {
		await v2();
		await run('V2');
		expect(read('config/untouched.toml')).toBe('v2');
		expect(read('config/added.toml')).toBe('new');
		expect(existsSync(join(root, 'config/dropped.toml'))).toBe(false);
	});

	it('keeps a config the player edited unless asked to replace it', async () => {
		await v2();
		await run('V2');
		expect(read('config/edited.toml')).toBe('player edit');
		expect(lastOutcome(id)?.details?.join('\n')).toContain('config/edited.toml');
	});

	it('replaces the edited config when asked', async () => {
		await v2();
		await run('V2', { replaceConfigs: true });
		expect(read('config/edited.toml')).toBe('v2');
	});

	it('previews the same decisions without changing anything', async () => {
		await v2();
		const preview = await U.previewModpackUpdate(id, 'V2', { replaceConfigs: false });
		expect(preview.writeConfigs.sort()).toEqual(['config/added.toml', 'config/untouched.toml']);
		expect(preview.removeConfigs).toEqual(['config/dropped.toml']);
		expect(preview.conflicts).toEqual(['config/edited.toml']);
		expect(read('config/untouched.toml')).toBe('v1');
		expect(state().packVersionId).toBe('V1');
	});
});

describe('a new Minecraft version or loader build', () => {
	it('installs the loader beside the server and updates the instance', async () => {
		await installV1({ 'mods/a.jar': 'a1' });
		put('server.jar', '1.21.4-0.16.0');
		await makePack({
			versionId: 'V2',
			versionNumber: '2.0',
			files: { 'mods/a.jar': 'a2' },
			mc: '1.21.5',
			loaderVersion: '0.17.0'
		});
		await run('V2');
		expect(fake.installs).toEqual([{ dir: `${root}.updating`, mc: '1.21.5', build: '0.17.0' }]);
		expect(read('server.jar')).toBe('1.21.5-0.17.0');
		expect(state()).toMatchObject({ mcVersion: '1.21.5', loaderVersion: '0.17.0' });
	});

	it('does not touch the loader when it is the same', async () => {
		await installV1({ 'mods/a.jar': 'a1' });
		await makePack({ versionId: 'V2', versionNumber: '2.0', files: { 'mods/a.jar': 'a2' } });
		await run('V2');
		expect(fake.installs).toEqual([]);
	});

	it('goes back to automatic Java when the chosen one is too old', async () => {
		db.update(instances).set({ javaMajor: 17 }).where(eq(instances.id, id)).run();
		await installV1({});
		await makePack({ versionId: 'V2', versionNumber: '2.0', files: {}, mc: '1.21.5' });
		await run('V2');
		expect(state().javaMajor).toBeNull();
	});
});

describe('a failing update', () => {
	it('leaves the server, the instance and the manifest exactly as they were', async () => {
		await installV1({ 'mods/a.jar': 'a1', 'mods/b.jar': 'b1' });
		const before = readManifest(id);
		await makePack({
			versionId: 'V2',
			versionNumber: '2.0',
			files: { 'mods/a.jar': 'a2', 'mods/b.jar': 'b2' }
		});
		fake.failUrl = 'https://cdn.modrinth.com/data/V2/mods/b.jar';

		await run('V2');

		expect(read('mods/a.jar')).toBe('a1');
		expect(read('mods/b.jar')).toBe('b1');
		expect(readManifest(id)).toEqual(before);
		expect(state()).toMatchObject({ packVersionId: 'V1', installState: 'ready' });
		expect(lastOutcome(id)).toMatchObject({ ok: false });
		expect(existsSync(`${root}.updating`)).toBe(false);
	});

	it('can be tried again afterwards', async () => {
		await installV1({ 'mods/a.jar': 'a1' });
		await makePack({ versionId: 'V2', versionNumber: '2.0', files: { 'mods/a.jar': 'a2' } });
		fake.failUrl = 'https://cdn.modrinth.com/data/V2/mods/a.jar';
		await run('V2');
		fake.failUrl = null;
		await run('V2');
		expect(read('mods/a.jar')).toBe('a2');
	});
});

describe('backup', () => {
	it('makes a before-update backup when asked, and not otherwise', async () => {
		await installV1({ 'mods/a.jar': 'a1' });
		await makePack({ versionId: 'V2', versionNumber: '2.0', files: { 'mods/a.jar': 'a2' } });
		await run('V2', { backup: false });
		expect(listBackups(id)).toEqual([]);

		db.update(instances)
			.set({ packVersionId: 'V1', packVersionNumber: '1.0' })
			.where(eq(instances.id, id))
			.run();
		await makePack({ versionId: 'V3', versionNumber: '3.0', files: { 'mods/a.jar': 'a3' } });
		await run('V3', { backup: true });
		expect(listBackups(id)[0]).toMatchObject({ kind: 'before-update' });
	});
});

describe('refusals', () => {
	beforeEach(async () => {
		await installV1({ 'mods/a.jar': 'a1' });
		await makePack({ versionId: 'V2', versionNumber: '2.0', files: { 'mods/a.jar': 'a2' } });
	});

	it('a running server', async () => {
		fake.running = true;
		await expect(
			U.startModpackUpdate(id, { versionId: 'V2', backup: false, replaceConfigs: false })
		).rejects.toThrow(/Stop the server/);
	});

	it('the version it already has', async () => {
		await expect(
			U.startModpackUpdate(id, { versionId: 'V1', backup: false, replaceConfigs: false })
		).rejects.toThrow(/Already on that version/);
	});

	it('another modpack', async () => {
		await makePack({ versionId: 'X1', versionNumber: '1', files: {}, projectId: 'OTHER' });
		await expect(
			U.startModpackUpdate(id, { versionId: 'X1', backup: false, replaceConfigs: false })
		).rejects.toThrow(/different modpack/);
	});

	it('a version that switches loaders', async () => {
		await makePack({ versionId: 'F1', versionNumber: '3.0', files: {}, loader: 'forge' });
		await expect(
			U.startModpackUpdate(id, { versionId: 'F1', backup: false, replaceConfigs: false })
		).rejects.toThrow(/create a new instance/);
	});

	it('an instance that did not come from a modpack', async () => {
		const other = makeInstance().id;
		await expect(
			U.startModpackUpdate(other, { versionId: 'V2', backup: false, replaceConfigs: false })
		).rejects.toThrow(/not created from a modpack/);
	});

	it('an instance that is busy', async () => {
		const first = await U.startModpackUpdate(id, {
			versionId: 'V2',
			backup: false,
			replaceConfigs: false
		});
		await expect(
			U.startModpackUpdate(id, { versionId: 'V2', backup: false, replaceConfigs: false })
		).rejects.toThrow(/Wait for the install/);
		await first.finished;
	});
});

describe('modpackInfo', () => {
	it('names the pack and lists its versions, newest first', async () => {
		await installV1({});
		const info = await U.modpackInfo(id);
		expect(info.pack).toMatchObject({ projectId: 'PACK', versionId: 'V1', versionNumber: '1.0' });
		expect(info.versions.map((v) => v.versionNumber)).toEqual(['2.0', '1.0']);
	});

	it('has no pack for an instance that did not come from one', async () => {
		expect((await U.modpackInfo(makeInstance().id)).pack).toBeNull();
	});
});
