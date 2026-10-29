import { mkdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { installedMods } from './db/schema';
import { downloadFile } from './download';
import { getInstance, serverDir } from './instances';
import * as modrinth from './modrinth';
import { readProperties, setProperties } from './server-properties';

export type PackKind = 'resourcepack' | 'shader';

const KINDS = {
	resourcepack: { type: 'resourcepack', noun: 'resource pack', loaders: [] as string[] },
	// shader versions are tagged with the mod that runs them rather than a server loader
	shader: {
		type: 'shader',
		noun: 'shader pack',
		loaders: ['iris', 'optifine', 'canvas', 'vanilla']
	}
};

export type PackVersion = {
	id: string;
	versionNumber: string;
	versionType: 'release' | 'beta' | 'alpha';
	publishedAt: string;
};

function requireInstance(instanceId: number) {
	const inst = getInstance(instanceId);
	if (!inst) throw new Error('Instance not found');
	return inst;
}

export function listPacks(instanceId: number, kind: PackKind) {
	return db
		.select()
		.from(installedMods)
		.where(and(eq(installedMods.instanceId, instanceId), eq(installedMods.kind, kind)))
		.orderBy(installedMods.title)
		.all();
}

export async function search(instanceId: number, kind: PackKind, query: string, limit: number) {
	const inst = requireInstance(instanceId);
	const res = await modrinth.searchProjects({
		query,
		loaders: [],
		type: KINDS[kind].type,
		serverSide: false,
		mc: inst.mcVersion,
		limit
	});
	return { hits: res.hits, total: res.total_hits };
}

async function compatibleVersions(instanceId: number, kind: PackKind, projectId: string) {
	const inst = requireInstance(instanceId);
	return modrinth.listVersions(projectId, KINDS[kind].loaders, inst.mcVersion);
}

export async function listPackVersions(
	instanceId: number,
	kind: PackKind,
	projectId: string
): Promise<PackVersion[]> {
	return (await compatibleVersions(instanceId, kind, projectId)).map((v) => ({
		id: v.id,
		versionNumber: v.version_number,
		versionType: v.version_type,
		publishedAt: v.date_published
	}));
}

/** The chosen version (among the compatible ones), else the newest release, else the newest. */
async function pickVersion(
	instanceId: number,
	kind: PackKind,
	projectId: string,
	versionId?: string
) {
	const versions = await compatibleVersions(instanceId, kind, projectId);
	const version = versionId
		? versions.find((v) => v.id === versionId)
		: (versions.find((v) => v.version_type === 'release') ?? versions[0]);
	if (!version) {
		const inst = requireInstance(instanceId);
		throw new Error(
			versionId
				? 'That version does not run on this server'
				: `No version for Minecraft ${inst.mcVersion} was found`
		);
	}
	const file = version.files.find((f) => f.primary) ?? version.files[0];
	if (!file) throw new Error(`Version ${version.version_number} has no files`);
	return { version, file };
}

async function projectInfo(projectId: string) {
	const [project] = await modrinth.getProjects([projectId]);
	return { title: project?.title ?? projectId, iconUrl: project?.icon_url ?? null };
}

/** Downloads a shader pack into shaderpacks/ and records it, replacing an earlier version. */
export async function installShader(instanceId: number, projectId: string, versionId?: string) {
	requireInstance(instanceId);
	const { version, file } = await pickVersion(instanceId, 'shader', projectId, versionId);

	// the name comes from a third party and is joined onto a path
	const name = basename(file.filename);
	if (name !== file.filename || name.startsWith('.') || !name.endsWith('.zip'))
		throw new Error(`Refusing unexpected file name "${file.filename}"`);

	const rel = `shaderpacks/${name}`;
	const dest = join(serverDir(instanceId), rel);
	const existing = listPacks(instanceId, 'shader').find((p) => p.projectId === projectId);
	if (!existing && (await Bun.file(dest).exists())) throw new Error(`${rel} already exists`);

	mkdirSync(join(serverDir(instanceId), 'shaderpacks'), { recursive: true });
	await downloadFile(dest, { url: file.url, hash: { algo: 'sha512', value: file.hashes.sha512 } });

	const info = await projectInfo(projectId);
	const row = {
		instanceId,
		kind: 'shader' as const,
		source: 'modrinth' as const,
		projectId,
		versionId: version.id,
		title: info.title,
		iconUrl: info.iconUrl,
		versionNumber: version.version_number,
		file: rel,
		hash: file.hashes.sha512,
		dependencyOf: null
	};
	if (existing) {
		db.update(installedMods).set(row).where(eq(installedMods.id, existing.id)).run();
		if (existing.file !== rel) rmSync(join(serverDir(instanceId), existing.file), { force: true });
	} else db.insert(installedMods).values(row).run();
	return { title: info.title, version: version.version_number };
}

// --- server resource pack: players download it from a URL, nothing is stored on the host ---

const propsFile = (instanceId: number) => join(serverDir(instanceId), 'server.properties');

export type ServerPack = {
	pack: ReturnType<typeof listPacks>[number] | null;
	required: boolean;
	prompt: string;
	/** a pack URL is set in server.properties that this panel did not put there */
	externalUrl: string | null;
};

/** A plain string is a valid JSON text component, which is what the prompt expects. */
const toPrompt = (text: string) => (text ? JSON.stringify(text) : '');
const fromPrompt = (raw: string) => {
	if (!raw) return '';
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed === 'string' ? parsed : raw;
	} catch {
		return raw;
	}
};

export function serverPack(instanceId: number): ServerPack {
	const props = readProperties(propsFile(instanceId));
	const pack = listPacks(instanceId, 'resourcepack')[0] ?? null;
	const url = props['resource-pack'] || null;
	return {
		pack,
		required: props['require-resource-pack'] === 'true',
		prompt: fromPrompt(props['resource-pack-prompt'] ?? ''),
		externalUrl: url && url !== pack?.url ? url : null
	};
}

/** Points the server at a Modrinth resource pack. Takes effect the next time the server starts. */
export async function useAsServerPack(instanceId: number, projectId: string, versionId?: string) {
	requireInstance(instanceId);
	const { version, file } = await pickVersion(instanceId, 'resourcepack', projectId, versionId);
	if (!file.url.startsWith('https://')) throw new Error('The pack has no public download URL');

	setProperties(propsFile(instanceId), {
		'resource-pack': file.url,
		'resource-pack-sha1': file.hashes.sha1
	});

	const info = await projectInfo(projectId);
	db.transaction((tx) => {
		// a server serves a single resource pack
		tx.delete(installedMods)
			.where(and(eq(installedMods.instanceId, instanceId), eq(installedMods.kind, 'resourcepack')))
			.run();
		tx.insert(installedMods)
			.values({
				instanceId,
				kind: 'resourcepack',
				source: 'modrinth',
				projectId,
				versionId: version.id,
				title: info.title,
				iconUrl: info.iconUrl,
				versionNumber: version.version_number,
				file: '',
				url: file.url,
				hash: file.hashes.sha1,
				dependencyOf: null
			})
			.run();
	});
	return { title: info.title, version: version.version_number };
}

export function setServerPackOptions(
	instanceId: number,
	options: { required: boolean; prompt: string }
) {
	requireInstance(instanceId);
	setProperties(propsFile(instanceId), {
		'require-resource-pack': options.required,
		'resource-pack-prompt': toPrompt(options.prompt.trim())
	});
}

export function removePack(instanceId: number, kind: PackKind, rowId: number) {
	const row = listPacks(instanceId, kind).find((p) => p.id === rowId);
	if (!row) throw new Error('Not installed');
	if (kind === 'shader') rmSync(join(serverDir(instanceId), row.file), { force: true });
	else setProperties(propsFile(instanceId), { 'resource-pack': '', 'resource-pack-sha1': '' });
	db.delete(installedMods).where(eq(installedMods.id, row.id)).run();
}
