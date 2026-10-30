import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeInstance } from '#test/instance.js';
import { db } from './db';
import { installedMods } from './db/schema';

// Modrinth is replaced: a project is whatever the test says it is.
const modrinth = vi.hoisted(() => ({
	versions: {} as Record<
		string,
		{
			project_id: string;
			dependencies?: { project_id: string | null; dependency_type: string }[];
		}
	>,
	projects: {} as Record<string, { title: string; client_side: string; server_side: string }>,
	fail: false
}));

vi.mock('./modrinth', async (original) => ({
	...(await original<typeof import('./modrinth')>()),
	versionsByHashes: async (hashes: string[]) => {
		if (modrinth.fail) throw new Error('Modrinth is down');
		return Object.fromEntries(
			hashes.filter((h) => modrinth.versions[h]).map((h) => [h, modrinth.versions[h]])
		);
	},
	getProjects: async (ids: string[]) => {
		if (modrinth.fail) throw new Error('Modrinth is down');
		return ids
			.filter((id) => modrinth.projects[id])
			.map((id) => ({ id, ...modrinth.projects[id] }));
	}
}));

const { clientOnlyFiles, projectSides } = await import('./mod-sides');
const { backfillSides, disableClientOnly, listInstalled } = await import('./mods');
const { serverDir } = await import('./instances');

const file = (path: string, sha512: string) => ({ path, hashes: { sha512 } });

beforeEach(() => {
	modrinth.fail = false;
	modrinth.versions = {
		h1: { project_id: 'SODIUM' },
		h2: { project_id: 'LITHIUM' },
		h3: { project_id: 'MODMENU' }
	};
	modrinth.projects = {
		SODIUM: { title: 'Sodium', client_side: 'required', server_side: 'unsupported' },
		LITHIUM: { title: 'Lithium', client_side: 'optional', server_side: 'required' },
		MODMENU: { title: 'Mod Menu', client_side: 'required', server_side: 'unsupported' }
	};
});

describe('projectSides', () => {
	it('reports where each project runs, and omits ones Modrinth does not know', async () => {
		const sides = await projectSides(['SODIUM', 'LITHIUM', 'GONE']);
		expect(sides.get('SODIUM')).toEqual({ clientSide: 'required', serverSide: 'unsupported' });
		expect(sides.get('LITHIUM')).toEqual({ clientSide: 'optional', serverSide: 'required' });
		expect(sides.has('GONE')).toBe(false);
	});
});

describe('clientOnlyFiles', () => {
	const files = [
		file('mods/sodium.jar', 'h1'),
		file('mods/lithium.jar', 'h2'),
		file('mods/unknown.jar', 'h9'),
		file('config/sodium.json', 'h1'),
		{ path: 'mods/nohash.jar', hashes: {} }
	];

	it('flags mods whose project does not run on a server, by title', async () => {
		const flagged = await clientOnlyFiles(files);
		expect([...flagged]).toEqual([['mods/sodium.jar', 'Sodium']]);
	});

	it('leaves alone what Modrinth does not know, files that are not mods, and ones with no hash', async () => {
		const flagged = await clientOnlyFiles(files);
		expect(flagged.has('mods/unknown.jar')).toBe(false);
		expect(flagged.has('config/sodium.json')).toBe(false);
		expect(flagged.has('mods/nohash.jar')).toBe(false);
	});

	it('flags nothing when Modrinth cannot be reached, so no mod is hidden by mistake', async () => {
		modrinth.fail = true;
		expect((await clientOnlyFiles(files)).size).toBe(0);
	});

	it('handles more mods than one request carries', async () => {
		const many = Array.from({ length: 250 }, (_, i) => file(`mods/m${i}.jar`, `x${i}`));
		many.forEach((f, i) => {
			modrinth.versions[f.hashes.sha512] = { project_id: `P${i}` };
			modrinth.projects[`P${i}`] = {
				title: `Mod ${i}`,
				client_side: 'required',
				server_side: i % 2 ? 'unsupported' : 'required'
			};
		});
		expect((await clientOnlyFiles(many)).size).toBe(125);
	});
});

describe('clientOnlyFiles and dependencies', () => {
	const dep = (project_id: string, dependency_type = 'required') => ({
		project_id,
		dependency_type
	});
	const flag = (...ids: string[]) =>
		ids.forEach(
			(id) =>
				(modrinth.projects[id] = { title: id, client_side: 'required', server_side: 'unsupported' })
		);
	const server = (...ids: string[]) =>
		ids.forEach(
			(id) =>
				(modrinth.projects[id] = { title: id, client_side: 'required', server_side: 'required' })
		);
	const pack = (...ids: string[]) => {
		ids.forEach((id) => (modrinth.versions[`h-${id}`] ??= { project_id: id }));
		return ids.map((id) => file(`mods/${id}.jar`, `h-${id}`));
	};
	const names = async (files: ReturnType<typeof pack>) =>
		[...(await clientOnlyFiles(files)).values()].sort();

	beforeEach(() => {
		modrinth.versions = {};
		modrinth.projects = {};
	});

	it('keeps a client-only mod that a mod which stays requires', async () => {
		server('A');
		flag('LIB', 'ALONE');
		modrinth.versions['h-A'] = { project_id: 'A', dependencies: [dep('LIB')] };
		expect(await names(pack('A', 'LIB', 'ALONE'))).toEqual(['ALONE']);
	});

	it('follows a chain: what a kept dependency requires is kept as well', async () => {
		server('A');
		flag('B', 'C', 'ALONE');
		modrinth.versions['h-A'] = { project_id: 'A', dependencies: [dep('B')] };
		modrinth.versions['h-B'] = { project_id: 'B', dependencies: [dep('C')] };
		expect(await names(pack('A', 'B', 'C', 'ALONE'))).toEqual(['ALONE']);
	});

	it('does not count optional or embedded dependencies, or a requirement from a skipped mod', async () => {
		server('A');
		flag('OPT', 'EMB', 'B', 'ONLY_FOR_B');
		modrinth.versions['h-A'] = {
			project_id: 'A',
			dependencies: [dep('OPT', 'optional'), dep('EMB', 'embedded')]
		};
		modrinth.versions['h-B'] = { project_id: 'B', dependencies: [dep('ONLY_FOR_B')] };
		expect(await names(pack('A', 'OPT', 'EMB', 'B', 'ONLY_FOR_B'))).toEqual([
			'B',
			'EMB',
			'ONLY_FOR_B',
			'OPT'
		]);
	});

	it('copes with a mod that has no dependency list and with circular requirements', async () => {
		server('A');
		flag('B', 'C');
		modrinth.versions['h-A'] = { project_id: 'A' };
		modrinth.versions['h-B'] = { project_id: 'B', dependencies: [dep('C')] };
		modrinth.versions['h-C'] = { project_id: 'C', dependencies: [dep('B')] };
		expect(await names(pack('A', 'B', 'C'))).toEqual(['B', 'C']);

		modrinth.versions['h-A'] = { project_id: 'A', dependencies: [dep('B')] };
		expect(await names(pack('A', 'B', 'C'))).toEqual([]);
	});
});

describe('installed mods', () => {
	let id: number;
	const add = (
		projectId: string,
		title: string,
		filename: string,
		sides: [string | null, string | null]
	) => {
		const root = serverDir(id);
		mkdirSync(join(root, 'mods'), { recursive: true });
		writeFileSync(join(root, 'mods', filename), 'jar');
		db.insert(installedMods)
			.values({
				instanceId: id,
				source: 'modrinth',
				projectId,
				versionId: 'v',
				title,
				versionNumber: '1',
				file: `mods/${filename}`,
				clientSide: sides[0],
				serverSide: sides[1]
			})
			.run();
	};

	beforeEach(() => {
		id = makeInstance({ loader: 'fabric' }).id;
	});

	it('fills in where mods run for rows recorded without it', async () => {
		add('SODIUM', 'Sodium', 'sodium.jar', [null, null]);
		add('LITHIUM', 'Lithium', 'lithium.jar', ['optional', 'required']);
		expect(await backfillSides(id)).toBe(1);
		const sodium = listInstalled(id).find((m) => m.projectId === 'SODIUM')!;
		expect(sodium).toMatchObject({ clientSide: 'required', serverSide: 'unsupported' });
	});

	it('does nothing when every row already knows', async () => {
		add('LITHIUM', 'Lithium', 'lithium.jar', ['optional', 'required']);
		expect(await backfillSides(id)).toBe(0);
	});

	it('disables only the enabled mods that do not run on a server, and says which', () => {
		add('SODIUM', 'Sodium', 'sodium.jar', ['required', 'unsupported']);
		add('MODMENU', 'Mod Menu', 'modmenu.jar', ['required', 'unsupported']);
		add('LITHIUM', 'Lithium', 'lithium.jar', ['optional', 'required']);
		db.update(installedMods)
			.set({ file: 'mods/modmenu.jar.disabled' })
			.where(eq(installedMods.projectId, 'MODMENU'))
			.run();
		writeFileSync(join(serverDir(id), 'mods', 'modmenu.jar.disabled'), 'jar');

		expect(disableClientOnly(id)).toEqual(['Sodium']);

		const by = Object.fromEntries(listInstalled(id).map((m) => [m.title, m.enabled]));
		expect(by).toEqual({ Sodium: false, 'Mod Menu': false, Lithium: true });
	});

	it('leaves mods with unknown sides alone', () => {
		add('X', 'Mystery', 'x.jar', [null, null]);
		expect(disableClientOnly(id)).toEqual([]);
		expect(listInstalled(id)[0].enabled).toBe(true);
	});
});
