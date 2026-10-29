import { mkdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { installedMods, settings } from './db/schema';
import { downloadFile } from './download';
import { getInstance, serverDir } from './instances';
import * as modrinth from './modrinth';
import { readProperties, setProperties } from './server-properties';
import { getSetting, setSetting } from './settings';

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
	/** uploaded to this host and served by the panel, rather than a Modrinth URL */
	manual: boolean;
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

/** Removes the server pack row, and the stored file when it was an uploaded one. */
function dropServerPackRows(instanceId: number, keepFile?: string) {
	for (const row of listPacks(instanceId, 'resourcepack')) {
		if (row.file && row.file !== keepFile)
			rmSync(join(serverDir(instanceId), row.file), { force: true });
	}
	db.delete(installedMods)
		.where(and(eq(installedMods.instanceId, instanceId), eq(installedMods.kind, 'resourcepack')))
		.run();
}

export function serverPack(instanceId: number): ServerPack {
	const props = readProperties(propsFile(instanceId));
	const pack = listPacks(instanceId, 'resourcepack')[0] ?? null;
	const url = props['resource-pack'] || null;
	return {
		pack,
		manual: pack?.source === 'manual',
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
	// a server serves a single resource pack
	dropServerPackRows(instanceId);
	db.transaction((tx) => {
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
	if (kind === 'shader') {
		rmSync(join(serverDir(instanceId), row.file), { force: true });
		db.delete(installedMods).where(eq(installedMods.id, row.id)).run();
	} else {
		setProperties(propsFile(instanceId), { 'resource-pack': '', 'resource-pack-sha1': '' });
		dropServerPackRows(instanceId);
	}
}

// --- manual uploads ---

/** Minecraft clients refuse server resource packs above this size. */
export const MAX_PACK_BYTES = 250 * 1024 * 1024;

const PUBLIC_URL = 'publicUrl';

export const configuredPublicUrl = () => getSetting(PUBLIC_URL) ?? null;

const hex = (algo: 'sha1' | 'sha512', bytes: Uint8Array) =>
	new Bun.CryptoHasher(algo).update(bytes).digest('hex');

/** True when the zip has an entry with this name at its root (not nested in a folder). */
function hasRootEntry(zip: Buffer, name: string) {
	for (let at = zip.indexOf(name); at !== -1; at = zip.indexOf(name, at + 1)) {
		if (at === 0 || zip[at - 1] !== 0x2f) return true;
	}
	return false;
}

function validateZip(bytes: Uint8Array, kind: PackKind) {
	const zip = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (!(zip[0] === 0x50 && zip[1] === 0x4b && zip[2] === 0x03 && zip[3] === 0x04))
		throw new Error('That is not a .zip file');
	if (kind === 'resourcepack' && !hasRootEntry(zip, 'pack.mcmeta'))
		throw new Error('This is not a resource pack: pack.mcmeta must be at the top of the zip');
	if (kind === 'shader' && !hasRootEntry(zip, 'shaders/'))
		throw new Error('This is not a shader pack: a shaders/ folder must be at the top of the zip');
}

/** Keeps the name safe to join onto a path and to put in a URL. */
function safeName(raw: string) {
	const base = basename(raw)
		.replace(/[^\w .()+-]/g, '_')
		.replace(/^\.+/, '_');
	return base.toLowerCase().endsWith('.zip') ? base : `${base}.zip`;
}

const manualUrl = (base: string, instanceId: number, sha1: string) =>
	`${base}/packs/${instanceId}/${sha1}.zip`;

/**
 * Saves an uploaded pack in the instance folder. A resource pack also becomes the server pack,
 * served by this panel at a public URL so players can download it; `origin` is the address the
 * admin is using, unless a public URL is configured.
 */
export async function uploadPack(instanceId: number, kind: PackKind, file: File, origin: string) {
	requireInstance(instanceId);
	if (file.size === 0) throw new Error('The file is empty');
	if (file.size > MAX_PACK_BYTES)
		throw new Error(`Packs can be at most ${MAX_PACK_BYTES / 1024 / 1024} MB`);

	const bytes = new Uint8Array(await file.arrayBuffer());
	validateZip(bytes, kind);

	const name = safeName(file.name);
	const folder = kind === 'shader' ? 'shaderpacks' : 'resourcepacks';
	const rel = `${folder}/${name}`;
	const dest = join(serverDir(instanceId), rel);
	const sha1 = hex('sha1', bytes);
	const title = name.replace(/\.zip$/i, '');

	if (kind === 'shader') {
		const projectId = `manual:${name}`;
		const existing = listPacks(instanceId, 'shader').find((p) => p.projectId === projectId);
		if (!existing && (await Bun.file(dest).exists())) throw new Error(`${rel} already exists`);
		mkdirSync(join(serverDir(instanceId), folder), { recursive: true });
		await Bun.write(dest, bytes);
		const row = {
			instanceId,
			kind: 'shader' as const,
			source: 'manual' as const,
			projectId,
			versionId: sha1,
			title,
			iconUrl: null,
			versionNumber: 'uploaded',
			file: rel,
			hash: hex('sha512', bytes),
			dependencyOf: null
		};
		if (existing) db.update(installedMods).set(row).where(eq(installedMods.id, existing.id)).run();
		else db.insert(installedMods).values(row).run();
		return { title, kind };
	}

	const base = (configuredPublicUrl() ?? origin).replace(/\/$/, '');
	const url = manualUrl(base, instanceId, sha1);
	mkdirSync(join(serverDir(instanceId), folder), { recursive: true });
	await Bun.write(dest, bytes);
	// a server serves a single resource pack
	dropServerPackRows(instanceId, rel);
	setProperties(propsFile(instanceId), { 'resource-pack': url, 'resource-pack-sha1': sha1 });
	db.insert(installedMods)
		.values({
			instanceId,
			kind: 'resourcepack',
			source: 'manual',
			projectId: `manual:${sha1}`,
			versionId: sha1,
			title,
			iconUrl: null,
			versionNumber: 'uploaded',
			file: rel,
			url,
			hash: sha1,
			dependencyOf: null
		})
		.run();
	return { title, kind, url };
}

/** The stored file behind a public pack download, if this exact pack is the instance's current one. */
export function manualPackFile(instanceId: number, sha1: string) {
	const row = listPacks(instanceId, 'resourcepack').find(
		(p) => p.source === 'manual' && p.hash === sha1
	);
	return row ? join(serverDir(instanceId), row.file) : null;
}

/**
 * Sets the address players use to reach this panel, and rewrites every uploaded server
 * pack's URL to match. Pass an empty string to clear it.
 */
export function setPublicUrl(value: string) {
	const trimmed = value.trim();
	if (trimmed) {
		let url: URL;
		try {
			url = new URL(trimmed);
		} catch {
			throw new Error('Enter a full address such as https://panel.example.com');
		}
		if (url.protocol !== 'http:' && url.protocol !== 'https:')
			throw new Error('The address must start with http:// or https://');
		setSetting(PUBLIC_URL, url.origin);
	} else {
		db.delete(settings).where(eq(settings.key, PUBLIC_URL)).run();
	}

	const base = configuredPublicUrl();
	if (!base) return;
	for (const row of db
		.select()
		.from(installedMods)
		.where(and(eq(installedMods.kind, 'resourcepack'), eq(installedMods.source, 'manual')))
		.all()) {
		const url = manualUrl(base, row.instanceId, row.hash!);
		db.update(installedMods).set({ url }).where(eq(installedMods.id, row.id)).run();
		setProperties(propsFile(row.instanceId), { 'resource-pack': url });
	}
}
