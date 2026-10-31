import { and, eq } from 'drizzle-orm';
import { join } from 'node:path';

import { db } from './db';
import { installedMods } from './db/schema';
import { getInstance, serverDir } from './instances';
import * as modrinth from './modrinth';
import { assertWritable } from './operations';
import { readProperties, setProperties } from './server-properties';

// A server has a single resource pack, delivered to players by URL: the pack's Modrinth download
// address and sha1 go into server.properties, and nothing is stored on this host.

export type PackVersion = {
	id: string;
	versionNumber: string;
	versionType: 'release' | 'beta' | 'alpha';
	publishedAt: string;
};

function instanceRow(instanceId: number) {
	const inst = getInstance(instanceId);
	if (!inst) throw new Error('Instance not found');
	return inst;
}

const propsFile = (instanceId: number) => join(serverDir(instanceId), 'server.properties');

function currentRow(instanceId: number) {
	return db
		.select()
		.from(installedMods)
		.where(and(eq(installedMods.instanceId, instanceId), eq(installedMods.kind, 'resourcepack')))
		.get();
}

export async function search(instanceId: number, query: string, limit: number) {
	const inst = instanceRow(instanceId);
	const res = await modrinth.searchProjects({
		query,
		loaders: [],
		type: 'resourcepack',
		serverSide: false, // resource packs are used by the client
		mc: inst.mcVersion,
		limit
	});
	return { hits: res.hits, total: res.total_hits };
}

function compatibleVersions(instanceId: number, projectId: string) {
	const inst = instanceRow(instanceId);
	return modrinth.listVersions(projectId, [], inst.mcVersion);
}

export async function listPackVersions(
	instanceId: number,
	projectId: string
): Promise<PackVersion[]> {
	return (await compatibleVersions(instanceId, projectId)).map((v) => ({
		id: v.id,
		versionNumber: v.version_number,
		versionType: v.version_type,
		publishedAt: v.date_published
	}));
}

/** The chosen version (among the compatible ones), else the newest release, else the newest. */
async function pickVersion(instanceId: number, projectId: string, versionId?: string) {
	const versions = await compatibleVersions(instanceId, projectId);
	const version = versionId
		? versions.find((v) => v.id === versionId)
		: (versions.find((v) => v.version_type === 'release') ?? versions[0]);
	if (!version) {
		const inst = instanceRow(instanceId);
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

export type ServerPack = {
	pack: NonNullable<ReturnType<typeof currentRow>> | null;
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
	const pack = currentRow(instanceId) ?? null;
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
	instanceRow(instanceId);
	assertWritable(instanceId);
	const { version, file } = await pickVersion(instanceId, projectId, versionId);
	if (!file.url.startsWith('https://')) throw new Error('The pack has no public download URL');

	setProperties(propsFile(instanceId), {
		'resource-pack': file.url,
		'resource-pack-sha1': file.hashes.sha1
	});

	const [project] = await modrinth.getProjects([projectId]);
	db.transaction((tx) => {
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
				title: project?.title ?? projectId,
				iconUrl: project?.icon_url ?? null,
				versionNumber: version.version_number,
				file: '',
				url: file.url,
				hash: file.hashes.sha1,
				dependencyOf: null
			})
			.run();
	});
	return { title: project?.title ?? projectId, version: version.version_number };
}

export function setServerPackOptions(
	instanceId: number,
	options: { required: boolean; prompt: string }
) {
	instanceRow(instanceId);
	assertWritable(instanceId);
	setProperties(propsFile(instanceId), {
		'require-resource-pack': options.required,
		'resource-pack-prompt': toPrompt(options.prompt.trim())
	});
}

export function removePack(instanceId: number, rowId: number) {
	assertWritable(instanceId);
	const row = currentRow(instanceId);
	if (!row || row.id !== rowId) throw new Error('Not in use');
	setProperties(propsFile(instanceId), { 'resource-pack': '', 'resource-pack-sha1': '' });
	db.delete(installedMods).where(eq(installedMods.id, row.id)).run();
}
