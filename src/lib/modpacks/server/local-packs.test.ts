import { eq } from 'drizzle-orm';
import { existsSync, readdirSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Version = {
	id: string;
	project_id: string;
	version_number: string;
	date_published: string;
	game_versions: string[];
	loaders: string[];
	version_type: 'release' | 'beta' | 'alpha';
	files: {
		filename: string;
		url: string;
		size: number;
		primary: boolean;
		hashes: { sha1: string; sha512: string };
	}[];
	dependencies: { project_id: string | null; version_id: string | null; dependency_type: string }[];
};

const fake = vi.hoisted(() => {
	const versions: Record<string, unknown>[] = [];
	return { versions, mcs: ['1.20.1', '1.21.1'] };
});

const version = (
	project: string,
	number: string,
	mc: string[],
	deps: Version['dependencies'] = [],
	type: Version['version_type'] = 'release'
): Version => ({
	id: `${project}-${number}`,
	project_id: project,
	version_number: number,
	date_published: '2026-01-01T00:00:00Z',
	game_versions: mc,
	loaders: ['fabric'],
	version_type: type,
	files: [
		{
			filename: `${project}-${number}.jar`,
			url: `https://cdn.modrinth.com/data/${project}/${number}.jar`,
			size: 100,
			primary: true,
			hashes: { sha1: `sha1-${project}-${number}`, sha512: `sha512-${project}-${number}` }
		}
	],
	dependencies: deps
});

vi.mock('#lib/server/loaders.js', async (original) => ({
	...(await original<typeof import('#lib/server/loaders.js')>()),
	isKnownVersion: async (_loader: string, mc: string) => fake.mcs.includes(mc),
	latestBuild: async (_loader: string, mc: string) => `build-${mc}`,
	loaderBuilds: async (_loader: string, mc: string) => [`build-${mc}`, `older-${mc}`]
}));

const searches = vi.hoisted(() => [] as Record<string, unknown>[]);
const lookups = vi.hoisted(() => ({ versionLists: 0, loaders: {} as Record<string, string[]> }));

vi.mock('#lib/server/modrinth.js', () => ({
	searchProjects: async (opts: Record<string, unknown>) => {
		searches.push(opts);
		return { hits: [], total_hits: 0 };
	},
	listVersions: async (project: string, loaders: string[], mc?: string) => {
		lookups.versionLists++;
		lookups.loaders[project] = loaders;
		return (fake.versions as Version[])
			.filter((v) => v.project_id === project && (!mc || v.game_versions.includes(mc)))
			.toSorted((a, b) => b.version_number.localeCompare(a.version_number));
	},
	getVersion: async (id: string) => (fake.versions as Version[]).find((v) => v.id === id)!,
	getProjects: async (ids: string[]) =>
		ids.map((id) => ({
			id,
			title: id.toUpperCase(),
			icon_url: null,
			client_side: id === 'clientmod' ? 'required' : 'optional',
			server_side: id === 'clientmod' ? 'unsupported' : 'required'
		})),
	versionsByHashes: async (hashes: string[]) =>
		Object.fromEntries(
			(fake.versions as Version[])
				.filter((v) => hashes.includes(v.files[0].hashes.sha512))
				.map((v) => [v.files[0].hashes.sha512, v])
		)
}));

const { db } = await import('#lib/server/db/index.js');
const { localPackFiles, localPacks } = await import('#lib/server/db/schema.js');
const P = await import('./local-packs');

// The config file API as seen from inside overrides/, where the cases below are written: paths go
// in without their folder and come back without it. The three folders have their own tests.
const inO = (path: string) => `overrides/${path}`;
const outO = (path: string) => path.replace(/^overrides\//, '');
type Changes = Parameters<typeof P.applyOverrideChanges>[1];
const C = {
	saveOverride: (id: number, rel: string, bytes: Uint8Array) => P.saveOverride(id, inO(rel), bytes),
	saveOverrides: (id: number, files: { rel: string; bytes: Uint8Array }[]) =>
		P.saveOverrides(
			id,
			files.map((f) => ({ ...f, rel: inO(f.rel) }))
		),
	listOverrides: (id: number) => P.listOverrides(id).map((f) => ({ ...f, path: outO(f.path) })),
	readOverrideText: (id: number, rel: string) => P.readOverrideText(id, inO(rel)),
	exportOverridesZip(id: number, paths: string[]) {
		const zip = P.exportOverridesZip(id, paths.map(inO));
		return { ...zip, entries: zip.entries.map((e) => ({ ...e, name: outO(e.name) })) };
	},
	async applyOverrideChanges(id: number, changes: Changes, check?: (path: string) => void) {
		try {
			const result = await P.applyOverrideChanges(
				id,
				{
					moves: changes.moves.map((m) => ({ from: inO(m.from), to: inO(m.to) })),
					deletes: changes.deletes.map(inO),
					writes: changes.writes.map((w) => ({
						...w,
						path: inO(w.path),
						...(w.original === undefined ? {} : { original: inO(w.original) })
					}))
				},
				check && ((path) => check(outO(path)))
			);
			const hashes = Object.entries(result.hashes).map(([k, v]) => [outO(k), v]);
			return { ...result, hashes: Object.fromEntries(hashes) as Record<string, string> };
		} catch (e) {
			if (e instanceof Error && 'path' in e) Object.assign(e, { path: outO(String(e.path)) });
			throw e;
		}
	}
};
const { Zip } = await import('#lib/server/zip.js');
const { readMrpack } = await import('./mrpack');
const { assertMayWriteCode } = await import('#lib/server/host-code.js');

beforeEach(() => {
	db.delete(localPacks).run();
	fake.versions.length = 0;
	fake.versions.push(
		version(
			'sodium',
			'2.0',
			['1.21.1'],
			[
				{ project_id: 'fabric-api', version_id: null, dependency_type: 'required' },
				{ project_id: 'optional-thing', version_id: null, dependency_type: 'optional' },
				{ project_id: 'no-version', version_id: null, dependency_type: 'required' }
			]
		),
		version('sodium', '1.0', ['1.20.1', '1.21.1']),
		version('sodium', '3.0-beta', ['1.21.1'], [], 'beta'),
		version('fabric-api', '9.0', ['1.20.1', '1.21.1']),
		version('lithium', '1.0', ['1.21.1']),
		version('clientmod', '1.0', ['1.21.1']),
		resourcePack('fresh', '2.0', ['1.21.1']),
		resourcePack('fresh', '1.0', ['1.20.1', '1.21.1']),
		resourcePack('newonly', '1.0', ['1.21.1'])
	);
});

// a resource pack: no loader of its own, and a .zip
const resourcePack = (project: string, number: string, mc: string[]): Version => {
	const v = version(project, number, mc);
	v.loaders = ['minecraft'];
	v.files[0]!.filename = `${project}-${number}.zip`;
	return v;
};

const make = (mc = '1.21.1') => P.createPack({ name: 'My pack', loader: 'fabric', mcVersion: mc });

describe('createPack', () => {
	it('pins the loader build and starts at revision 1', async () => {
		const pack = await make();
		expect(pack).toMatchObject({
			name: 'My pack',
			loader: 'fabric',
			loaderVersion: 'build-1.21.1',
			mcVersion: '1.21.1',
			revision: 1
		});
	});

	it('refuses a loader the builder does not make, an unknown version and an empty name', async () => {
		await expect(
			P.createPack({ name: 'x', loader: 'paper' as never, mcVersion: '1.21.1' })
		).rejects.toThrow('fabric, quilt');
		await expect(make('9.9.9')).rejects.toThrow('no Minecraft 9.9.9');
		await expect(
			P.createPack({ name: '  ', loader: 'fabric', mcVersion: '1.21.1' })
		).rejects.toThrow('name');
	});
});

describe('addMod', () => {
	it('adds the newest release with its required dependencies, pinned to hashes', async () => {
		const pack = await make();
		const result = await P.addMod(pack.id, 'sodium');
		expect(result.added.map((a) => a.title).sort()).toEqual(['FABRIC-API', 'SODIUM']);
		expect(result.skipped).toEqual(['NO-VERSION']);
		const files = P.listFiles(pack.id);
		const sodium = files.find((f) => f.projectId === 'sodium')!;
		expect(sodium).toMatchObject({
			versionNumber: '2.0',
			path: 'mods/sodium-2.0.jar',
			sha512: 'sha512-sodium-2.0',
			serverSide: 'required'
		});
		expect(files.find((f) => f.projectId === 'fabric-api')!.dependencyOf).toBe('sodium');
	});

	it('refuses a mod already in the pack and bumps the revision on each change', async () => {
		const pack = await make();
		await P.addMod(pack.id, 'lithium');
		await expect(P.addMod(pack.id, 'lithium')).rejects.toThrow('Already');
		expect(P.getPack(pack.id).revision).toBe(2);
	});

	it('takes a chosen version, only among those that run in the pack', async () => {
		const pack = await make();
		await P.addMod(pack.id, 'sodium', 'sodium-1.0');
		expect(P.listFiles(pack.id).find((f) => f.projectId === 'sodium')!.versionNumber).toBe('1.0');
		const other = await make();
		await expect(P.addMod(other.id, 'lithium', 'sodium-1.0')).rejects.toThrow('does not run');
	});

	it('fails when the mod has nothing for this version', async () => {
		const pack = await make('1.20.1');
		await expect(P.addMod(pack.id, 'lithium')).rejects.toThrow('No fabric version');
	});
});

describe('removing and re-pinning', () => {
	it('removes a file and re-pins a mod to another compatible version', async () => {
		const pack = await make();
		await P.addMod(pack.id, 'sodium');
		const sodium = P.listFiles(pack.id).find((f) => f.projectId === 'sodium')!;
		await P.setModVersion(pack.id, sodium.id, 'sodium-1.0');
		expect(P.listFiles(pack.id).find((f) => f.id === sodium.id)).toMatchObject({
			versionNumber: '1.0',
			path: 'mods/sodium-1.0.jar'
		});
		await expect(P.setModVersion(pack.id, sodium.id, 'lithium-1.0')).rejects.toThrow(
			'does not run'
		);
		P.removeFile(pack.id, sodium.id);
		expect(P.listFiles(pack.id).some((f) => f.id === sodium.id)).toBe(false);
	});
});

describe('changing the Minecraft version', () => {
	it('lists what carries over and what has no version, without changing anything', async () => {
		const pack = await make();
		await P.addMod(pack.id, 'sodium');
		await P.addMod(pack.id, 'lithium');
		const preview = await P.previewVersionChange(pack.id, '1.20.1');
		expect(preview.compatible.map((c) => c.title).sort()).toEqual(['FABRIC-API', 'SODIUM']);
		expect(preview.incompatible.map((c) => c.title)).toEqual(['LITHIUM']);
		expect(P.getPack(pack.id).mcVersion).toBe('1.21.1');
	});

	it('asks Modrinth about each mod once, whether previewing or applying', async () => {
		const pack = await make();
		await P.addMod(pack.id, 'sodium');
		const mods = P.listFiles(pack.id).filter((f) => f.projectId).length;
		lookups.versionLists = 0;
		await P.previewVersionChange(pack.id, '1.20.1');
		expect(lookups.versionLists).toBe(mods);
		lookups.versionLists = 0;
		await P.applyVersionChange(pack.id, '1.20.1');
		expect(lookups.versionLists).toBe(mods);
	});

	it('only applies once nothing is incompatible, unless told to drop those', async () => {
		const pack = await make();
		await P.addMod(pack.id, 'sodium');
		await P.addMod(pack.id, 'lithium');
		await expect(P.applyVersionChange(pack.id, '1.20.1')).rejects.toThrow('remove them first');
		const result = await P.applyVersionChange(pack.id, '1.20.1', true);
		expect(result).toEqual({ updated: 2, removed: 1 });
		const after = P.getPack(pack.id);
		expect(after).toMatchObject({ mcVersion: '1.20.1', loaderVersion: 'build-1.20.1' });
		expect(after.files.find((f) => f.projectId === 'sodium')!.versionNumber).toBe('1.0');
		expect(after.files.some((f) => f.projectId === 'lithium')).toBe(false);
	});
});

describe('config files', () => {
	const enc = (text: string) => new TextEncoder().encode(text);
	const put = (packId: number, files: Record<string, string>) =>
		C.saveOverrides(
			packId,
			Object.entries(files).map(([rel, text]) => ({ rel, bytes: enc(text) }))
		);
	const paths = (packId: number) => C.listOverrides(packId).map((f) => f.path);
	const hashOf = (packId: number, rel: string) => C.readOverrideText(packId, rel).hash;
	const revision = (packId: number) => P.getPack(packId).revision;
	const none = { moves: [], deletes: [], writes: [] };

	it('stores files by path, lists them, and refuses a path that leaves the folder', async () => {
		const pack = await make();
		await C.saveOverride(pack.id, 'config/sodium.json', enc('{}'));
		expect(C.listOverrides(pack.id)).toEqual([{ path: 'config/sodium.json', size: 2 }]);
		await expect(C.saveOverride(pack.id, '../escape.txt', new Uint8Array())).rejects.toThrow(
			'unsafe'
		);
	});

	it('stores several files as one revision, and writes none when one path leaves the folder', async () => {
		const pack = await make();
		await C.saveOverrides(pack.id, [
			{ rel: 'config/a.toml', bytes: enc('x') },
			{ rel: 'config/sub/b.toml', bytes: enc('x') }
		]);
		expect(revision(pack.id)).toBe(pack.revision + 1);
		expect(paths(pack.id)).toEqual(['config/a.toml', 'config/sub/b.toml']);

		await expect(
			C.saveOverrides(pack.id, [
				{ rel: 'config/c.toml', bytes: enc('x') },
				{ rel: '../d.toml', bytes: enc('x') }
			])
		).rejects.toThrow('unsafe');
		expect(paths(pack.id)).toHaveLength(2);
		expect(revision(pack.id)).toBe(pack.revision + 1);
	});

	it('reads a file as text with a hash, and refuses a missing or binary one, or one too large', async () => {
		const pack = await make();
		await put(pack.id, { 'a.txt': 'one', 'bom.txt': '\uFEFFhi' });
		expect(C.readOverrideText(pack.id, 'a.txt')).toMatchObject({ content: 'one', size: 3 });
		expect(C.readOverrideText(pack.id, 'bom.txt').content).toBe('\uFEFFhi');
		await C.saveOverride(pack.id, 'blob.json', new Uint8Array([123, 0, 125]));
		expect(() => C.readOverrideText(pack.id, 'blob.json')).toThrow('binary');
		expect(() => C.readOverrideText(pack.id, 'missing.json')).toThrow('not found');
		await C.saveOverride(pack.id, 'big.txt', new Uint8Array(2 * 1024 * 1024 + 1));
		expect(() => C.readOverrideText(pack.id, 'big.txt')).toThrow('too large');
	});

	describe('applying changes together', () => {
		it('does moves, deletes, edits and new files as one revision', async () => {
			const pack = await make();
			await put(pack.id, {
				'config/a.toml': 'a = 1',
				'config/sub/b.toml': 'b = 1',
				'old/c.json': '{}',
				'keep.txt': 'keep'
			});
			const before = revision(pack.id);
			const result = await C.applyOverrideChanges(pack.id, {
				moves: [{ from: 'config/a.toml', to: 'moved/a.toml' }],
				deletes: ['old/c.json'],
				writes: [
					{
						path: 'keep.txt',
						original: 'keep.txt',
						baseHash: hashOf(pack.id, 'keep.txt'),
						content: 'kept!'
					},
					{ path: 'config/new.toml', content: 'n = 1' }
				]
			});
			expect(result.changed).toBe(4);
			expect(result.hashes['keep.txt']).toBe(hashOf(pack.id, 'keep.txt'));
			expect(paths(pack.id)).toEqual([
				'config/new.toml',
				'config/sub/b.toml',
				'keep.txt',
				'moved/a.toml'
			]);
			expect(C.readOverrideText(pack.id, 'keep.txt').content).toBe('kept!');
			expect(revision(pack.id)).toBe(before + 1);
		});

		it('writes an edited file at the place it is moved to, built on the text it was opened as', async () => {
			const pack = await make();
			await put(pack.id, { 'a.toml': 'a = 1' });
			await C.applyOverrideChanges(pack.id, {
				moves: [{ from: 'a.toml', to: 'config/a.toml' }],
				deletes: [],
				writes: [
					{
						path: 'config/a.toml',
						original: 'a.toml',
						baseHash: hashOf(pack.id, 'a.toml'),
						content: 'a = 2'
					}
				]
			});
			expect(paths(pack.id)).toEqual(['config/a.toml']);
			expect(C.readOverrideText(pack.id, 'config/a.toml').content).toBe('a = 2');
		});

		it('lets two files swap places, and a move land on the name a delete frees', async () => {
			const pack = await make();
			await put(pack.id, { 'a.txt': 'A', 'b.txt': 'B', 'c.txt': 'C' });
			await C.applyOverrideChanges(pack.id, {
				moves: [
					{ from: 'a.txt', to: 'b.txt' },
					{ from: 'b.txt', to: 'a.txt' },
					{ from: 'c.txt', to: 'd.txt' }
				],
				deletes: [],
				writes: []
			});
			expect(C.readOverrideText(pack.id, 'a.txt').content).toBe('B');
			expect(C.readOverrideText(pack.id, 'b.txt').content).toBe('A');
			expect(C.readOverrideText(pack.id, 'd.txt').content).toBe('C');

			await C.applyOverrideChanges(pack.id, {
				moves: [{ from: 'd.txt', to: 'a.txt' }],
				deletes: ['a.txt'],
				writes: []
			});
			expect(C.readOverrideText(pack.id, 'a.txt').content).toBe('C');
		});

		it('removes a folder that lost its last file, but not the ones that still hold something', async () => {
			const pack = await make();
			await put(pack.id, { 'a/b/c.txt': '1', 'a/d.txt': '2', 'x/y/z.txt': '3' });
			await C.applyOverrideChanges(pack.id, {
				moves: [{ from: 'a/b/c.txt', to: 'c.txt' }],
				deletes: ['x/y/z.txt'],
				writes: []
			});
			expect(existsSync(`${P.overridesDir(pack.id)}/a/b`)).toBe(false);
			expect(existsSync(`${P.overridesDir(pack.id)}/a`)).toBe(true);
			expect(existsSync(`${P.overridesDir(pack.id)}/x`)).toBe(false);
			expect(existsSync(P.overridesDir(pack.id))).toBe(true);
		});

		it('names the refused path, and says when a file changed since it was opened', async () => {
			const pack = await make();
			await put(pack.id, { 'a.txt': 'A', 'b.txt': 'B' });
			const stale = { path: 'a.txt', original: 'a.txt', baseHash: 'f'.repeat(40), content: 'A!' };
			await expect(
				C.applyOverrideChanges(pack.id, { moves: [], deletes: [], writes: [stale] })
			).rejects.toMatchObject({ path: 'a.txt', kind: 'stale' });
			await expect(
				C.applyOverrideChanges(pack.id, {
					moves: [{ from: 'b.txt', to: 'a.txt' }],
					deletes: [],
					writes: []
				})
			).rejects.toMatchObject({ path: 'a.txt', kind: 'refused' });
			await expect(
				C.applyOverrideChanges(pack.id, { moves: [], deletes: ['nope.txt'], writes: [] })
			).rejects.toMatchObject({ path: 'nope.txt', kind: 'refused' });
		});

		it('changes nothing, and adds no revision, when one part is refused', async () => {
			const pack = await make();
			await put(pack.id, { 'a.txt': 'A', 'b.txt': 'B', 'dir/c.txt': 'C' });
			const before = revision(pack.id);
			const refuse = async (
				changes: Parameters<typeof P.applyOverrideChanges>[1],
				message: string
			) => {
				await expect(C.applyOverrideChanges(pack.id, changes, undefined)).rejects.toThrow(message);
				expect(paths(pack.id)).toEqual(['a.txt', 'b.txt', 'dir/c.txt']);
				expect(C.readOverrideText(pack.id, 'a.txt').content).toBe('A');
				expect(revision(pack.id)).toBe(before);
			};
			const edit = {
				path: 'a.txt',
				original: 'a.txt',
				baseHash: hashOf(pack.id, 'a.txt'),
				content: 'A!'
			};
			await refuse(
				{ moves: [{ from: 'b.txt', to: 'dir/c.txt' }], deletes: [], writes: [edit] },
				'dir/c.txt: already exists'
			);
			await refuse(
				{ moves: [{ from: 'b.txt', to: 'dir' }], deletes: [], writes: [edit] },
				'dir: is a folder'
			);
			await refuse(
				{ moves: [{ from: 'b.txt', to: 'a.txt/x' }], deletes: [], writes: [] },
				'a.txt: is a file'
			);
			await refuse(
				{ moves: [{ from: 'nope.txt', to: 'x.txt' }], deletes: [], writes: [edit] },
				'nope.txt: not found'
			);
			await refuse({ moves: [], deletes: ['nope.txt'], writes: [edit] }, 'nope.txt: not found');
			await refuse(
				{ moves: [{ from: 'b.txt', to: '../x.txt' }], deletes: [], writes: [edit] },
				'not allowed'
			);
			await refuse(
				{
					moves: [
						{ from: 'b.txt', to: 'x.txt' },
						{ from: 'a.txt', to: 'x.txt' }
					],
					deletes: [],
					writes: []
				},
				'x.txt: already exists'
			);
			await refuse(
				{ moves: [{ from: 'b.txt', to: 'x.txt' }], deletes: ['b.txt'], writes: [] },
				'b.txt: is moved and deleted'
			);
			await refuse(
				{ moves: [], deletes: [], writes: [{ ...edit, baseHash: 'f'.repeat(40) }] },
				'a.txt: This file changed since you opened it'
			);
			await refuse(
				{ moves: [], deletes: ['a.txt'], writes: [edit] },
				'a.txt: This file changed since you opened it'
			);
			await refuse(
				{ moves: [{ from: 'a.txt', to: 'x.txt' }], deletes: [], writes: [edit] },
				'a.txt: does not go where it was moved to'
			);
			await refuse(
				{ moves: [], deletes: [], writes: [{ path: 'b.txt', content: 'new' }, edit] },
				'b.txt: already exists'
			);
			await refuse(
				{ moves: [], deletes: [], writes: [{ path: 'new.jar', content: 'x' }, edit] },
				'new.jar: This file type cannot be edited'
			);
			await refuse(
				{
					moves: [],
					deletes: [],
					writes: [{ path: 'new.txt', content: 'x'.repeat(2 * 1024 * 1024 + 1) }, edit]
				},
				'too large'
			);
			await refuse({ moves: [], deletes: [], writes: [edit, edit] }, 'a.txt: is in the list twice');
			await refuse(
				{ moves: [], deletes: [], writes: [{ path: 'a.txt', content: 'x' }] },
				'a.txt: already exists'
			);
		});

		it('asks about every path a move or a write touches, and stops at the first refusal', async () => {
			const pack = await make();
			await put(pack.id, { 'a.txt': 'A', 'b.txt': 'B' });
			const asked: string[] = [];
			await C.applyOverrideChanges(
				pack.id,
				{
					moves: [{ from: 'a.txt', to: 'x/a.txt' }],
					deletes: ['b.txt'],
					writes: [{ path: 'new.txt', content: 'n' }]
				},
				(path) => asked.push(path)
			);
			// a delete takes nothing in, so it is not asked about
			expect(asked.sort()).toEqual(['a.txt', 'new.txt', 'x/a.txt']);

			const before = paths(pack.id);
			await expect(
				C.applyOverrideChanges(
					pack.id,
					{ moves: [{ from: 'x/a.txt', to: 'run.sh' }], deletes: [], writes: [] },
					(path) => {
						if (path === 'run.sh') throw new Error('Only the owner may add or change run.sh');
					}
				)
			).rejects.toThrow('Only the owner');
			expect(paths(pack.id)).toEqual(before);
		});

		it('adds no revision when nothing changes', async () => {
			const pack = await make();
			await put(pack.id, { 'a.txt': 'A' });
			const before = revision(pack.id);
			const hash = hashOf(pack.id, 'a.txt');
			const same = await C.applyOverrideChanges(pack.id, {
				moves: [{ from: 'a.txt', to: 'a.txt' }],
				deletes: [],
				writes: [{ path: 'a.txt', original: 'a.txt', baseHash: hash, content: 'A' }]
			});
			expect(same).toEqual({ changed: 0, hashes: { 'a.txt': hash } });
			expect((await C.applyOverrideChanges(pack.id, none)).changed).toBe(0);
			expect(revision(pack.id)).toBe(before);
		});
	});

	it('lists the chosen files for a zip, folders kept, and refuses a missing or empty choice', async () => {
		const pack = await make();
		await put(pack.id, { 'config/sodium/a.json': 'x', 'config/b.toml': 'x', 'options.txt': 'x' });
		const { filename, entries } = C.exportOverridesZip(pack.id, [
			'config',
			'config/b.toml',
			'options.txt'
		]);
		expect(filename).toBe('My-pack-configs.zip');
		expect(entries.map((e) => e.name).sort()).toEqual([
			'config/b.toml',
			'config/sodium/a.json',
			'options.txt'
		]);
		expect(() => C.exportOverridesZip(pack.id, ['nope'])).toThrow(
			'nothing to download in overrides/nope'
		);
		expect(() => C.exportOverridesZip(pack.id, [])).toThrow('Choose');
	});
});

describe('the three config folders', () => {
	const enc = (text: string) => new TextEncoder().encode(text);
	const files = (packId: number) => P.listOverrides(packId).map((f) => f.path);
	/** What a server made from the pack gets, by path in the server folder. */
	async function serverGets(packId: number) {
		const mrpack = readMrpack((await P.exportBytes(packId)).bytes);
		return Object.fromEntries(
			[...mrpack.overrides].map(([path, entry]) => [
				path,
				new TextDecoder().decode(mrpack.read(entry))
			])
		);
	}

	it('keeps a file in each folder, exports all three, and an import keeps them apart', async () => {
		const pack = await make();
		await P.saveOverrides(pack.id, [
			{ rel: 'overrides/config/a.toml', bytes: enc('both') },
			{ rel: 'server-overrides/config/a.toml', bytes: enc('server') },
			{ rel: 'client-overrides/options.txt', bytes: enc('client') }
		]);
		expect(files(pack.id)).toEqual([
			'client-overrides/options.txt',
			'overrides/config/a.toml',
			'server-overrides/config/a.toml'
		]);
		const zip = new Zip((await P.exportBytes(pack.id)).bytes);
		expect(zip.entries.map((e) => e.name)).toEqual(
			expect.arrayContaining([
				'overrides/config/a.toml',
				'server-overrides/config/a.toml',
				'client-overrides/options.txt'
			])
		);
		const copy = await P.importMrpack((await P.exportBytes(pack.id)).bytes);
		expect(files(copy.id)).toEqual(files(pack.id));
	});

	it('gives a server overrides with server-overrides on top, and never client-overrides', async () => {
		const pack = await make();
		await P.saveOverrides(pack.id, [
			{ rel: 'overrides/config/a.toml', bytes: enc('both') },
			{ rel: 'overrides/config/b.toml', bytes: enc('b') },
			{ rel: 'server-overrides/config/a.toml', bytes: enc('server') },
			{ rel: 'client-overrides/options.txt', bytes: enc('client') }
		]);
		expect(await serverGets(pack.id)).toEqual({ 'config/a.toml': 'server', 'config/b.toml': 'b' });

		// a change only players see leaves what a server gets as it was
		const before = await serverGets(pack.id);
		await P.saveOverride(pack.id, 'client-overrides/options.txt', enc('changed'));
		expect(await serverGets(pack.id)).toEqual(before);
	});

	it('moves files between the folders', async () => {
		const pack = await make();
		await P.saveOverride(pack.id, 'overrides/config/a.toml', enc('a'));
		await P.applyOverrideChanges(pack.id, {
			moves: [{ from: 'overrides/config/a.toml', to: 'server-overrides/config/a.toml' }],
			deletes: [],
			writes: []
		});
		expect(files(pack.id)).toEqual(['server-overrides/config/a.toml']);
	});

	it('never moves or deletes a folder itself, and keeps files inside the three', async () => {
		const pack = await make();
		await P.saveOverride(pack.id, 'overrides/a.txt', enc('a'));
		const refused = (changes: Partial<Parameters<typeof P.applyOverrideChanges>[1]>) =>
			expect(P.applyOverrideChanges(pack.id, { moves: [], deletes: [], writes: [], ...changes }))
				.rejects;
		await refused({ deletes: ['overrides'] }).toThrow('overrides is always there');
		await refused({ moves: [{ from: 'overrides', to: 'server-overrides/x' }] }).toThrow(
			'always there'
		);
		await refused({ moves: [{ from: 'overrides/a.txt', to: 'a.txt' }] }).toThrow(
			'Config files go in'
		);
		await refused({ writes: [{ path: 'notes.txt', content: 'x' }] }).toThrow('Config files go in');
		await expect(P.saveOverride(pack.id, 'notes.txt', enc('x'))).rejects.toThrow('is not inside');
		expect(() => P.readOverrideText(pack.id, 'modrinth.index.json')).toThrow('is not inside');
		expect(files(pack.id)).toEqual(['overrides/a.txt']);
	});

	it('keeps code to the owner in every folder', async () => {
		const pack = await make();
		const member = { id: 2, role: 'user' } as const;
		for (const side of ['overrides', 'server-overrides', 'client-overrides'])
			await expect(
				P.applyOverrideChanges(
					pack.id,
					{ moves: [], deletes: [], writes: [{ path: `${side}/user_jvm_args.txt`, content: '' }] },
					(path) => assertMayWriteCode(member, path)
				)
			).rejects.toThrow('Only the owner');
	});
});

describe('the .mrpack', () => {
	it('builds a Modrinth index with the loader, hashes, sides and the revision as its version', async () => {
		const pack = await make();
		await P.addMod(pack.id, 'clientmod');
		const index = P.buildIndex(pack.id);
		expect(index).toMatchObject({
			formatVersion: 1,
			game: 'minecraft',
			name: 'My pack',
			versionId: '2',
			dependencies: { minecraft: '1.21.1', 'fabric-loader': 'build-1.21.1' }
		});
		expect(index.files[0]).toMatchObject({
			path: 'mods/clientmod-1.0.jar',
			hashes: { sha1: 'sha1-clientmod-1.0', sha512: 'sha512-clientmod-1.0' },
			env: { client: 'required', server: 'unsupported' },
			downloads: ['https://cdn.modrinth.com/data/clientmod/1.0.jar']
		});
	});

	it('round-trips: an export reads as a valid pack, and importing it gives the same pack back', async () => {
		const pack = await make();
		await P.addMod(pack.id, 'sodium');
		await P.saveOverride(pack.id, 'overrides/config/a.toml', new TextEncoder().encode('x=1'));
		const { bytes, filename } = await P.exportBytes(pack.id);
		expect(filename).toMatch(/^My-pack-\d+\.mrpack$/);

		const zip = new Zip(bytes);
		expect(readMrpack(bytes).files).toHaveLength(2);
		expect(zip.entries.map((e) => e.name)).toContain('overrides/config/a.toml');

		const copy = await P.importMrpack(bytes);
		const imported = P.getPack(copy.id);
		expect(imported).toMatchObject({
			name: 'My pack',
			loader: 'fabric',
			mcVersion: '1.21.1',
			loaderVersion: 'build-1.21.1'
		});
		expect(imported.files.map((f) => [f.path, f.projectId, f.versionNumber]).sort()).toEqual([
			['mods/fabric-api-9.0.jar', 'fabric-api', '9.0'],
			['mods/sodium-2.0.jar', 'sodium', '2.0']
		]);
		expect(imported.overrides).toEqual([{ path: 'overrides/config/a.toml', size: 3 }]);
	});

	it('keeps a file Modrinth does not know, and refuses a pack with no mod loader or a broken one', async () => {
		const pack = await make();
		db.insert(localPackFiles)
			.values({
				packId: pack.id,
				title: 'custom.jar',
				path: 'mods/custom.jar',
				downloads: JSON.stringify(['https://github.com/x/y/custom.jar']),
				sha512: 'unknown-hash'
			})
			.run();
		const { bytes } = await P.exportBytes(pack.id);
		const copy = await P.importMrpack(bytes, 'Renamed');
		expect(P.getPack(copy.id)).toMatchObject({ name: 'Renamed' });
		expect(P.listFiles(copy.id)[0]).toMatchObject({
			projectId: null,
			title: 'custom.jar',
			path: 'mods/custom.jar'
		});
		await expect(P.importMrpack(new Uint8Array([1, 2, 3]))).rejects.toThrow('zip');
		expect(db.select().from(localPacks).all()).toHaveLength(2);
	});
	it('takes from anyone but the owner only files Modrinth knows, and no code in the config files', async () => {
		const pack = await make();
		await P.addMod(pack.id, 'sodium');
		await P.saveOverride(pack.id, 'overrides/config/a.toml', new TextEncoder().encode('x=1'));
		const vetted = (await P.exportBytes(pack.id)).bytes;
		const before = db.select().from(localPacks).all().length;

		await P.saveOverride(pack.id, 'overrides/mods/evil.jar', new TextEncoder().encode('jar'));
		await expect(
			P.importMrpack((await P.exportBytes(pack.id)).bytes, undefined, { vettedOnly: true })
		).rejects.toThrow(/code in its config files, such as overrides\/mods\/evil\.jar/);
		await P.applyOverrideChanges(pack.id, {
			moves: [],
			deletes: ['overrides/mods/evil.jar'],
			writes: []
		});

		db.insert(localPackFiles)
			.values({
				packId: pack.id,
				title: 'custom.jar',
				path: 'mods/custom.jar',
				downloads: JSON.stringify(['https://github.com/x/y/custom.jar']),
				sha512: 'unknown-hash'
			})
			.run();
		await expect(
			P.importMrpack((await P.exportBytes(pack.id)).bytes, undefined, { vettedOnly: true })
		).rejects.toThrow(/Modrinth does not know, such as mods\/custom\.jar/);
		expect(db.select().from(localPacks).all()).toHaveLength(before);

		const copy = await P.importMrpack(vetted, undefined, { vettedOnly: true });
		expect(P.getPack(copy.id).files.every((f) => f.projectId)).toBe(true);
	});
});

describe('searching mods', () => {
	it('includes client-only mods such as Sodium, for the loader and Minecraft version', async () => {
		const pack = await make();
		await P.searchMods(pack.id, 'sodium', 10);
		expect(searches.at(-1)).toMatchObject({
			query: 'sodium',
			loaders: ['fabric'],
			mc: '1.21.1'
		});
	});
});

describe('loader version', () => {
	it('offers the builds for the pack, pins one, and refuses one it does not have', async () => {
		const pack = await make();
		expect(await P.packLoaderBuilds(pack.id)).toEqual(['build-1.21.1', 'older-1.21.1']);
		const revision = P.getPack(pack.id).revision;
		await P.setLoaderVersion(pack.id, 'older-1.21.1');
		expect(P.getPack(pack.id)).toMatchObject({
			loaderVersion: 'older-1.21.1',
			revision: revision + 1
		});
		await expect(P.setLoaderVersion(pack.id, 'nope')).rejects.toThrow(
			'fabric has no build nope for Minecraft 1.21.1'
		);
	});
});

describe('duplicating and deleting', () => {
	it('copies the files and config, and delete removes the pack, its rows and its folder', async () => {
		const pack = await make();
		await P.addMod(pack.id, 'lithium');
		await P.saveOverride(pack.id, 'overrides/config/a.toml', new TextEncoder().encode('x'));
		const copy = P.duplicatePack(pack.id);
		expect(copy).toMatchObject({ name: 'My pack copy', revision: 1 });
		expect(P.listFiles(copy.id)).toHaveLength(1);
		expect(P.listOverrides(copy.id)).toHaveLength(1);

		P.deletePack(copy.id);
		expect(
			db.select().from(localPackFiles).where(eq(localPackFiles.packId, copy.id)).all()
		).toEqual([]);
		expect(existsSync(P.packDir(copy.id))).toBe(false);
		expect(P.listPacks().map((p) => p.id)).toEqual([pack.id]);
	});
});

describe('the icon', () => {
	const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
	const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
	const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

	it('has none to begin with, and stores a PNG, JPEG or WebP, judged by its bytes', async () => {
		const pack = await make();
		expect(P.getPack(pack.id).iconUrl).toBeNull();
		for (const [bytes, type] of [
			[png, 'image/png'],
			[jpg, 'image/jpeg'],
			[webp, 'image/webp']
		] as const) {
			await P.saveIcon(pack.id, bytes);
			expect(P.iconFile(pack.id)).toMatchObject({ type });
		}
		expect(P.getPack(pack.id).iconUrl).toMatch(new RegExp(`^/modpacks/${pack.id}/icon\\?v=\\d+$`));
	});

	it('keeps one icon: a new one replaces the old, whatever its type', async () => {
		const pack = await make();
		await P.saveIcon(pack.id, jpg);
		await P.saveIcon(pack.id, png);
		expect(readdirSync(P.packDir(pack.id)).filter((f) => f.startsWith('icon.'))).toEqual([
			'icon.png'
		]);
	});

	it('refuses something that is not an image, however it was named, and one that is too large', async () => {
		const pack = await make();
		await expect(
			P.saveIcon(pack.id, new TextEncoder().encode('<svg onload=alert(1)>'))
		).rejects.toThrow('PNG, JPEG or WebP');
		await expect(
			P.saveIcon(pack.id, new Uint8Array(2 * 1024 * 1024 + 1).fill(0xff))
		).rejects.toThrow('too large');
		expect(P.iconFile(pack.id)).toBeNull();
	});

	it('counts as a change, and is copied with a duplicate and removed on request', async () => {
		const pack = await make();
		await P.saveIcon(pack.id, png);
		expect(P.getPack(pack.id).revision).toBe(2);
		const copy = P.duplicatePack(pack.id);
		expect(P.iconFile(copy.id)).toMatchObject({ type: 'image/png' });
		P.removeIcon(pack.id);
		expect(P.iconFile(pack.id)).toBeNull();
		expect(P.iconFile(copy.id)).not.toBeNull();
	});
});

describe('resource packs', () => {
	it('adds a client resource pack to resourcepacks/, for players only, looked up with no loader', async () => {
		const pack = await make();
		const result = await P.addResourcePack(pack.id, 'fresh');
		expect(result).toEqual({ title: 'FRESH', version: '2.0' });
		expect(lookups.loaders.fresh).toEqual([]);
		const file = P.listFiles(pack.id).find((f) => f.projectId === 'fresh')!;
		expect(file).toMatchObject({
			path: 'resourcepacks/fresh-2.0.zip',
			clientSide: 'required',
			serverSide: 'unsupported'
		});
		expect(P.isResourcePack(file)).toBe(true);
		expect(P.buildIndex(pack.id).files[0]).toMatchObject({
			path: 'resourcepacks/fresh-2.0.zip',
			env: { client: 'required', server: 'unsupported' }
		});
		await expect(P.addResourcePack(pack.id, 'fresh')).rejects.toThrow('Already in the pack');
	});

	it('pins a chosen version, and refuses one for another Minecraft version', async () => {
		const pack = await make('1.20.1');
		await expect(P.addResourcePack(pack.id, 'fresh', 'fresh-2.0')).rejects.toThrow(
			'not for Minecraft 1.20.1'
		);
		await P.addResourcePack(pack.id, 'fresh', 'fresh-1.0');
		const file = P.listFiles(pack.id).find((f) => f.projectId === 'fresh')!;
		expect(file.path).toBe('resourcepacks/fresh-1.0.zip');
	});

	it('re-pins a resource pack to another version in resourcepacks/', async () => {
		const pack = await make();
		await P.addResourcePack(pack.id, 'fresh');
		const file = P.listFiles(pack.id).find((f) => f.projectId === 'fresh')!;
		await P.setModVersion(pack.id, file.id, 'fresh-1.0');
		expect(P.listFiles(pack.id).find((f) => f.id === file.id)!.path).toBe(
			'resourcepacks/fresh-1.0.zip'
		);
	});

	it('carries resource packs and the server pack over a Minecraft version change', async () => {
		const pack = await make();
		await P.addMod(pack.id, 'sodium');
		await P.addResourcePack(pack.id, 'fresh');
		await P.setServerPack(pack.id, 'fresh');
		const preview = await P.previewVersionChange(pack.id, '1.20.1');
		expect(preview.compatible.map((c) => c.title)).toContain('FRESH');
		await P.applyVersionChange(pack.id, '1.20.1', true);
		const after = P.getPack(pack.id);
		expect(after.files.find((f) => f.projectId === 'fresh')!.path).toBe(
			'resourcepacks/fresh-1.0.zip'
		);
		expect(after).toMatchObject({ serverPackProjectId: 'fresh', serverPackVersionNumber: '1.0' });
	});

	it('drops the server pack when it has no version for the new Minecraft version', async () => {
		const pack = await make();
		await P.setServerPack(pack.id, 'newonly');
		await P.applyVersionChange(pack.id, '1.20.1', true);
		expect(P.getPack(pack.id).serverPackProjectId).toBeNull();
	});
});

describe('the server resource pack', () => {
	it('is set, kept on a copy, and cleared, each a new revision', async () => {
		const pack = await make();
		expect(await P.setServerPack(pack.id, 'fresh')).toEqual({ title: 'FRESH', version: '2.0' });
		expect(P.getPack(pack.id)).toMatchObject({
			serverPackProjectId: 'fresh',
			serverPackVersionId: 'fresh-2.0',
			serverPackTitle: 'FRESH',
			revision: 2
		});
		const copy = P.duplicatePack(pack.id);
		expect(P.getPack(copy.id).serverPackProjectId).toBe('fresh');
		P.clearServerPack(pack.id);
		expect(P.getPack(pack.id)).toMatchObject({ serverPackProjectId: null, revision: 3 });
	});

	it('is not part of the .mrpack', async () => {
		const pack = await make();
		await P.setServerPack(pack.id, 'fresh');
		expect(P.buildIndex(pack.id).files).toEqual([]);
	});
});
