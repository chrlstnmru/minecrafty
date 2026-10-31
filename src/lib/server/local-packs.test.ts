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

vi.mock('./loaders', async (original) => ({
	...(await original<typeof import('./loaders')>()),
	isKnownVersion: async (_loader: string, mc: string) => fake.mcs.includes(mc),
	latestBuild: async (_loader: string, mc: string) => `build-${mc}`,
	loaderBuilds: async (_loader: string, mc: string) => [`build-${mc}`, `older-${mc}`]
}));

const searches = vi.hoisted(() => [] as Record<string, unknown>[]);
const lookups = vi.hoisted(() => ({ versionLists: 0 }));

vi.mock('./modrinth', () => ({
	searchProjects: async (opts: Record<string, unknown>) => {
		searches.push(opts);
		return { hits: [], total_hits: 0 };
	},
	listVersions: async (project: string, _loaders: string[], mc?: string) => {
		lookups.versionLists++;
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

const { db } = await import('./db');
const { localPackFiles, localPacks } = await import('./db/schema');
const P = await import('./local-packs');
const { Zip } = await import('./zip');
const { parseIndex } = await import('./modpacks');

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
		version('clientmod', '1.0', ['1.21.1'])
	);
});

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
	it('stores files by path, lists them, and refuses a path that leaves the folder', async () => {
		const pack = await make();
		await P.saveOverride(pack.id, 'config/sodium.json', new TextEncoder().encode('{}'));
		expect(P.listOverrides(pack.id)).toEqual([{ path: 'config/sodium.json', size: 2 }]);
		await expect(P.saveOverride(pack.id, '../escape.txt', new Uint8Array())).rejects.toThrow(
			'unsafe'
		);
		P.removeOverride(pack.id, 'config/sodium.json');
		expect(P.listOverrides(pack.id)).toEqual([]);
	});

	it('stores several files as one revision, and writes none when one path leaves the folder', async () => {
		const pack = await make();
		const bytes = new TextEncoder().encode('x');
		await P.saveOverrides(pack.id, [
			{ rel: 'config/a.toml', bytes },
			{ rel: 'config/sub/b.toml', bytes }
		]);
		expect(P.getPack(pack.id).revision).toBe(pack.revision + 1);
		expect(P.listOverrides(pack.id).map((f) => f.path)).toEqual([
			'config/a.toml',
			'config/sub/b.toml'
		]);

		await expect(
			P.saveOverrides(pack.id, [
				{ rel: 'config/c.toml', bytes },
				{ rel: '../d.toml', bytes }
			])
		).rejects.toThrow('unsafe');
		expect(P.listOverrides(pack.id)).toHaveLength(2);
		expect(P.getPack(pack.id).revision).toBe(pack.revision + 1);
	});

	it('edits text: a new file, then a changed one adds a revision, an identical save adds none', async () => {
		const pack = await make();
		const revision = () => P.getPack(pack.id).revision;
		await P.writeOverrideText(pack.id, 'config/a.toml', 'x = 1\n');
		expect(revision()).toBe(pack.revision + 1);

		const opened = P.readOverrideText(pack.id, 'config/a.toml');
		expect(opened).toMatchObject({ content: 'x = 1\n', size: 6 });

		await P.writeOverrideText(pack.id, 'config/a.toml', 'x = 1\n', opened.hash);
		expect(revision()).toBe(pack.revision + 1);

		await P.writeOverrideText(pack.id, 'config/a.toml', 'x = 2\n', opened.hash);
		expect(revision()).toBe(pack.revision + 2);
		expect(P.readOverrideText(pack.id, 'config/a.toml').content).toBe('x = 2\n');
	});

	it('refuses a save over a file that changed since it was opened, or a new file onto an existing one', async () => {
		const pack = await make();
		await P.writeOverrideText(pack.id, 'a.txt', 'one');
		const { hash } = P.readOverrideText(pack.id, 'a.txt');
		await P.writeOverrideText(pack.id, 'a.txt', 'two', hash);
		await expect(P.writeOverrideText(pack.id, 'a.txt', 'three', hash)).rejects.toThrow(
			'changed since you opened it'
		);
		expect(P.readOverrideText(pack.id, 'a.txt').content).toBe('two');
		await expect(P.writeOverrideText(pack.id, 'a.txt', 'new')).rejects.toThrow('already exists');
		P.removeOverride(pack.id, 'a.txt');
		await expect(P.writeOverrideText(pack.id, 'a.txt', 'again', hash)).rejects.toThrow(
			'changed since you opened it'
		);
	});

	it('keeps a byte order mark and refuses a type, size, binary file or path it cannot edit', async () => {
		const pack = await make();
		await P.writeOverrideText(pack.id, 'bom.txt', '﻿hi');
		expect(P.readOverrideText(pack.id, 'bom.txt').content).toBe('﻿hi');

		await expect(P.writeOverrideText(pack.id, 'mods/a.jar', 'x')).rejects.toThrow(
			'cannot be edited'
		);
		await expect(P.writeOverrideText(pack.id, '../a.txt', 'x')).rejects.toThrow('unsafe');
		await expect(
			P.writeOverrideText(pack.id, 'big.txt', 'x'.repeat(2 * 1024 * 1024 + 1))
		).rejects.toThrow('too large');

		await P.saveOverride(pack.id, 'blob.json', new Uint8Array([123, 0, 125]));
		expect(() => P.readOverrideText(pack.id, 'blob.json')).toThrow('binary');
		expect(() => P.readOverrideText(pack.id, 'missing.json')).toThrow('not found');
	});

	it('moves a file into another folder in one revision, and refuses a missing source, an existing target or a path that leaves the folder', async () => {
		const pack = await make();
		await P.writeOverrideText(pack.id, 'config/a.toml', 'x = 1');
		await P.writeOverrideText(pack.id, 'config/b.toml', 'y = 1');
		const before = P.getPack(pack.id).revision;

		P.moveOverride(pack.id, 'config/a.toml', 'config/sub/a.toml');
		expect(P.getPack(pack.id).revision).toBe(before + 1);
		expect(P.listOverrides(pack.id).map((f) => f.path)).toEqual([
			'config/b.toml',
			'config/sub/a.toml'
		]);

		expect(() => P.moveOverride(pack.id, 'config/nope.toml', 'config/c.toml')).toThrow('not found');
		expect(() => P.moveOverride(pack.id, 'config/b.toml', 'config/sub/a.toml')).toThrow(
			'already exists'
		);
		expect(() => P.moveOverride(pack.id, 'config/b.toml', '../b.toml')).toThrow('unsafe');
		expect(P.getPack(pack.id).revision).toBe(before + 1);
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
		await P.saveOverride(pack.id, 'config/a.toml', new TextEncoder().encode('x=1'));
		const { bytes, filename } = await P.exportBytes(pack.id);
		expect(filename).toMatch(/^My-pack-\d+\.mrpack$/);

		const zip = new Zip(bytes);
		expect(parseIndex(zip).files).toHaveLength(2);
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
		expect(imported.overrides).toEqual([{ path: 'config/a.toml', size: 3 }]);
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
		await P.saveOverride(pack.id, 'config/a.toml', new TextEncoder().encode('x=1'));
		const vetted = (await P.exportBytes(pack.id)).bytes;
		const before = db.select().from(localPacks).all().length;

		await P.saveOverride(pack.id, 'mods/evil.jar', new TextEncoder().encode('jar'));
		await expect(
			P.importMrpack((await P.exportBytes(pack.id)).bytes, undefined, { vettedOnly: true })
		).rejects.toThrow(/code in its config files, such as mods\/evil\.jar/);
		P.removeOverride(pack.id, 'mods/evil.jar');

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
			mc: '1.21.1',
			serverSide: false
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
		await P.saveOverride(pack.id, 'config/a.toml', new TextEncoder().encode('x'));
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
