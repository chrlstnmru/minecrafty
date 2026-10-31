import { describe, expect, it } from 'vitest';

import type { ModrinthVersion } from './modrinth';

import { pickFile, pickVersion, resolveMods, type VersionSource } from './mod-resolver';

type Dep = ModrinthVersion['dependencies'][number];

const required = (project_id: string, version_id: string | null = null): Dep => ({
	project_id,
	version_id,
	dependency_type: 'required'
});

function version(
	project: string,
	opts: Partial<ModrinthVersion> & { deps?: Dep[]; filename?: string } = {}
): ModrinthVersion {
	const { deps = [], filename = `${project}.jar`, ...rest } = opts;
	return {
		id: `${project}-v1`,
		project_id: project,
		version_number: '1.0',
		date_published: '2026-01-01T00:00:00Z',
		game_versions: ['1.21.4'],
		loaders: ['fabric'],
		version_type: 'release',
		files: [
			{
				url: `https://cdn.example/${filename}`,
				filename,
				primary: true,
				size: 1,
				hashes: { sha1: 'a', sha512: 'b' }
			}
		],
		dependencies: deps,
		...rest
	};
}

/** A version source with a fixed catalogue; `asked` records every lookup. */
function catalogue(versions: ModrinthVersion[]) {
	const asked: string[] = [];
	const source: VersionSource = {
		getVersion: async (id) => {
			asked.push(`version ${id}`);
			const found = versions.find((v) => v.id === id);
			if (!found) throw new Error(`no version ${id}`);
			return found;
		},
		listVersions: async (project) => {
			asked.push(`project ${project}`);
			return versions.filter((v) => v.project_id === project);
		}
	};
	return { source, asked };
}

const target = { loader: 'fabric', loaders: ['fabric'], mcVersion: '1.21.4' };

describe('resolveMods', () => {
	it('plans the project with its required dependencies, and records who needed them', async () => {
		const { source } = catalogue([
			version('sodium', { deps: [required('fabric-api')] }),
			version('fabric-api', { deps: [required('base')] }),
			version('base')
		]);
		const { planned, skipped } = await resolveMods(target, new Set(), 'sodium', { source });
		expect([...planned].map(([id, p]) => [id, p.dependencyOf])).toEqual([
			['sodium', null],
			['fabric-api', 'sodium'],
			['base', 'fabric-api']
		]);
		expect(skipped).toEqual([]);
	});

	it('leaves out optional dependencies and those already present', async () => {
		const { source, asked } = catalogue([
			version('sodium', {
				deps: [
					required('fabric-api'),
					{ project_id: 'extra', version_id: null, dependency_type: 'optional' }
				]
			}),
			version('fabric-api'),
			version('extra')
		]);
		const { planned } = await resolveMods(target, new Set(['fabric-api']), 'sodium', { source });
		expect([...planned.keys()]).toEqual(['sodium']);
		expect(asked).not.toContain('project extra');
	});

	it('skips a dependency with no compatible version, but fails when the project itself has none', async () => {
		const { source } = catalogue([version('sodium', { deps: [required('gone')] })]);
		const { planned, skipped } = await resolveMods(target, new Set(), 'sodium', { source });
		expect([...planned.keys()]).toEqual(['sodium']);
		expect(skipped).toEqual(['gone']);

		await expect(resolveMods(target, new Set(), 'missing', { source })).rejects.toThrow(
			'No fabric version for Minecraft 1.21.4 was found'
		);
	});

	it('uses the version a dependency pins, not the newest release', async () => {
		const pinned = version('lib', { id: 'lib-old', version_number: '0.9' });
		const { source, asked } = catalogue([
			version('sodium', { deps: [required('lib', 'lib-old')] }),
			version('lib'),
			pinned
		]);
		const { planned } = await resolveMods(target, new Set(), 'sodium', { source });
		expect(planned.get('lib')?.version.id).toBe('lib-old');
		expect(asked).toContain('version lib-old');
	});

	it('plans a chosen root version even when the project is present, as an update does', async () => {
		const chosen = version('sodium', { id: 'sodium-new', version_number: '2.0' });
		const { source } = catalogue([]);
		const { planned } = await resolveMods(target, new Set(['sodium']), 'sodium', {
			root: chosen,
			source
		});
		expect(planned.get('sodium')?.version).toBe(chosen);
	});

	it('does not plan a project twice when two mods need it', async () => {
		const { source } = catalogue([
			version('a', { deps: [required('c')] }),
			version('b'),
			version('c')
		]);
		const first = await resolveMods(target, new Set(), 'a', { source });
		expect([...first.planned.keys()]).toEqual(['a', 'c']);
		const second = await resolveMods(target, new Set(first.planned.keys()), 'b', { source });
		expect([...second.planned.keys()]).toEqual(['b']);
	});
});

describe('pickVersion', () => {
	it('prefers a release over a newer beta, and falls back to the newest', () => {
		const beta = version('x', { id: 'beta', version_type: 'beta' });
		const release = version('x', { id: 'rel' });
		expect(pickVersion([beta, release])?.id).toBe('rel');
		expect(pickVersion([beta])?.id).toBe('beta');
		expect(pickVersion([])).toBeUndefined();
	});
});

describe('pickFile', () => {
	it('prefers the primary file', () => {
		const v = version('x');
		v.files.unshift({ ...v.files[0], primary: false, filename: 'x-sources.jar' });
		expect(pickFile(v).filename).toBe('x.jar');
	});

	it.each(['../x.jar', 'sub/x.jar', '.hidden.jar', 'x.zip'])(
		'refuses the file name %s',
		(filename) => {
			expect(() => pickFile(version('x', { filename }))).toThrow(/Refusing unexpected file name/);
		}
	);

	it('refuses a version with no files', () => {
		expect(() => pickFile(version('x', { files: [] }))).toThrow(/no files/);
	});
});
