import { and, eq, inArray } from 'drizzle-orm';
import { createReadStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { javaOverride } from './config';
import { db } from './db';
import { installedMods } from './db/schema';
import { runUpdate } from './instance-job';
import { getInstance, serverDir } from './instances';
import { ensureJava, requiredJavaMajor } from './java';
import { isRunning } from './live-server';
import { installServer, launchArgs, needsJavaToInstall, type Loader } from './loaders';
import { readManifest, writeManifest, type PackManifest } from './modpack-manifest';
import {
	downloadFiles,
	overrideEntries,
	packFileHashes,
	safeJoin,
	sha1Of,
	trackMods,
	wantsOnServer,
	type IndexFile,
	type LoadedPack
} from './modpacks';
import { DISABLED_SUFFIX as DISABLED, setEnabledHeld } from './mods';
import { decide } from './pack-diff';
import { packSourceOf, type ModpackInfo } from './pack-source';
import { mergeStaged, removeStale } from './staged-install';
import { lastOutcome } from './update-outcome';

export { lastOutcome };

async function hashFile(path: string) {
	const hash = new Bun.CryptoHasher('sha1');
	for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
	return hash.digest('hex');
}

/** What a pack version would do to this instance. Nothing is changed by computing it. */
export type PackPlan = {
	versionId: string;
	versionNumber: string;
	name: string;
	mcVersion: string;
	loader: Loader;
	loaderVersion: string | null;
	/** the new version needs a different Minecraft version or loader build than the instance has */
	loaderChange: boolean;
	/** pack files to download: new ones and ones the pack changed, with whether the old copy was disabled */
	download: { file: IndexFile; disabled: boolean }[];
	/** files (as they are on disk) to delete because the pack dropped them */
	remove: string[];
	/** config files to write from the pack, and to delete */
	writeConfigs: string[];
	removeConfigs: string[];
	/** files the user changed that the pack also touches; they are left as they are */
	kept: string[];
	/** the subset of `kept` that are configs the pack changed (replaced only when asked) */
	conflicts: string[];
	downloadBytes: number;
};

/** The current copy of a pack file: where it is on disk (it may have been disabled), or null. */
function onDisk(server: string, rel: string) {
	if (existsSync(join(server, rel))) return rel;
	if (existsSync(join(server, rel + DISABLED))) return rel + DISABLED;
	return null;
}

export async function planModpackUpdate(
	instanceId: number,
	pack: LoadedPack,
	options: { replaceConfigs: boolean }
): Promise<PackPlan> {
	const inst = getInstance(instanceId);
	const source = inst && packSourceOf(inst);
	if (!inst || !source) throw new Error('This instance was not created from a modpack');
	const manifest = readManifest(instanceId);
	if (!manifest) throw new Error('There is no record of what the modpack installed here');
	const { summary } = pack;
	if (summary.projectId !== source.id) throw new Error('That is a different modpack');
	if (summary.loader !== inst.loader)
		throw new Error(
			`This version uses ${summary.loader} and the instance runs ${inst.loader}; create a new instance for it`
		);

	const server = serverDir(instanceId);
	const plan: PackPlan = {
		versionId: summary.versionId,
		versionNumber: summary.versionNumber,
		name: summary.name,
		mcVersion: summary.mcVersion,
		loader: summary.loader,
		loaderVersion: summary.loaderVersion,
		loaderChange:
			summary.mcVersion !== inst.mcVersion ||
			(summary.loaderVersion ?? null) !== (inst.loaderVersion ?? null),
		download: [],
		remove: [],
		writeConfigs: [],
		removeConfigs: [],
		kept: [],
		conflicts: [],
		downloadBytes: 0
	};

	const hashOf = async (rel: string | null) => (rel === null ? null : hashFile(join(server, rel)));

	const newFiles = new Map(pack.index.files.filter(wantsOnServer).map((f) => [f.path, f]));
	for (const [path, file] of newFiles) {
		safeJoin(server, path);
		const wanted = file.hashes.sha1;
		if (!wanted) throw new Error(`${path} has no SHA-1 in the modpack`);
		const installed = manifest.files[path];
		if (installed === wanted) continue;
		const current = onDisk(server, path);
		const decision = decide(installed, wanted, await hashOf(current));
		if (decision === 'add') plan.download.push({ file, disabled: false });
		else if (decision === 'update')
			plan.download.push({ file, disabled: current!.endsWith(DISABLED) });
		else if (decision === 'kept' || decision === 'conflict') plan.kept.push(path);
	}
	for (const [path, installed] of Object.entries(manifest.files)) {
		if (newFiles.has(path)) continue;
		const current = onDisk(server, path);
		const decision = decide(installed, undefined, await hashOf(current));
		if (decision === 'remove') plan.remove.push(current!);
		else if (decision === 'kept') plan.kept.push(path);
	}

	const newConfigs = new Map<string, string>();
	for (const [path, entry] of overrideEntries(pack.zip))
		newConfigs.set(path, sha1Of(pack.zip.read(entry)));
	const configOnDisk = (path: string) => (existsSync(join(server, path)) ? path : null);
	for (const [path, wanted] of newConfigs) {
		const installed = manifest.overrides[path];
		if (installed === wanted) continue;
		const decision = decide(installed, wanted, await hashOf(configOnDisk(path)));
		if (decision === 'add' || decision === 'update') plan.writeConfigs.push(path);
		else if (decision === 'kept') plan.kept.push(path);
		else if (decision === 'conflict') {
			plan.conflicts.push(path);
			if (options.replaceConfigs) plan.writeConfigs.push(path);
			else plan.kept.push(path);
		}
	}
	for (const [path, installed] of Object.entries(manifest.overrides)) {
		if (newConfigs.has(path)) continue;
		const decision = decide(installed, undefined, await hashOf(configOnDisk(path)));
		if (decision === 'remove') plan.removeConfigs.push(path);
		else if (decision === 'kept') plan.kept.push(path);
	}

	plan.downloadBytes = plan.download.reduce((sum, d) => sum + (d.file.fileSize ?? 0), 0);
	return plan;
}

/** The pack an instance came from and every version of it, newest first. */
export async function modpackInfo(instanceId: number): Promise<ModpackInfo> {
	const inst = getInstance(instanceId);
	if (!inst) throw new Error('Instance not found');
	const source = packSourceOf(inst);
	if (!source?.installedVersionId || !readManifest(instanceId))
		return { pack: null, source: 'modrinth', versions: [], error: null };
	return source.describe();
}

/** What updating to `versionId` would change, with nothing touched. */
export async function previewModpackUpdate(
	instanceId: number,
	versionId: string,
	options: { replaceConfigs: boolean }
) {
	const inst = getInstance(instanceId);
	if (!inst) throw new Error('Instance not found');
	const source = packSourceOf(inst);
	if (!source) throw new Error('This instance was not created from a modpack');
	const plan = await planModpackUpdate(instanceId, await source.load(versionId), options);
	const { download, ...rest } = plan;
	const old = readManifest(instanceId)?.files ?? {};
	return {
		...rest,
		added: download.filter((d) => old[d.file.path] === undefined).map((d) => d.file.path),
		updated: download.filter((d) => old[d.file.path] !== undefined).map((d) => d.file.path)
	};
}

/**
 * Starts moving an instance to another version of its modpack. The checks run now and throw;
 * the rest runs in the background while the instance shows as installing, and `finished`
 * settles when it is over. Files the user changed are never overwritten (a changed config is
 * replaced only when `replaceConfigs` says so). Everything is downloaded and prepared beside
 * the server first, so a failed download leaves the server exactly as it was.
 */
export async function startModpackUpdate(
	instanceId: number,
	opts: { versionId: string; backup: boolean; replaceConfigs: boolean }
) {
	const inst = getInstance(instanceId);
	const source = inst && packSourceOf(inst);
	if (!inst || !source) throw new Error('This instance was not created from a modpack');
	if (inst.installState !== 'ready') throw new Error('Wait for the install to finish');
	if (opts.versionId === source.installedVersionId) throw new Error('Already on that version');
	if (await isRunning(instanceId)) throw new Error('Stop the server before updating it');

	const pack = await source.load(opts.versionId);
	const plan = await planModpackUpdate(instanceId, pack, opts);
	const server = serverDir(instanceId);
	const from = source.installedLabel;

	const finished = runUpdate(
		instanceId,
		{
			kind: 'modpack',
			backup: opts.backup ? `Before updating to ${plan.name} ${plan.versionNumber}` : null
		},
		async ({ staging, progress, commit }) => {
			if (plan.loaderChange) {
				progress('Installing the new server');
				const java = needsJavaToInstall(plan.loader)
					? (javaOverride ?? (await ensureJava(await requiredJavaMajor(plan.mcVersion))))
					: undefined;
				await installServer({
					serverDir: staging,
					loader: plan.loader,
					mc: plan.mcVersion,
					build: plan.loaderVersion ?? undefined,
					java
				});
			}
			await downloadFiles(
				instanceId,
				staging,
				plan.download.map((d) => d.file)
			);
			const configs = overrideEntries(pack.zip);
			for (const path of plan.writeConfigs) {
				const dest = safeJoin(staging, path);
				mkdirSync(dirname(dest), { recursive: true });
				await Bun.write(dest, pack.zip.read(configs.get(path)!));
			}

			progress('Replacing the old files');
			commit();
			// a disabled mod that gets a new version keeps its place at the old path until it is re-disabled
			const replaced = plan.download.filter((d) => d.disabled).map((d) => d.file.path + DISABLED);
			for (const path of [...plan.remove, ...plan.removeConfigs, ...replaced])
				rmSync(join(server, path), { force: true });
			if (plan.loaderChange) removeStale(server, plan.loader);
			mergeStaged(server, staging);

			// the Mods tab follows the files: drop what changed or went, record what is new
			const gone = [...plan.remove, ...plan.download.map((d) => d.file.path)];
			if (gone.length)
				db.delete(installedMods)
					.where(
						and(
							eq(installedMods.instanceId, instanceId),
							inArray(installedMods.file, [...gone, ...gone.map((p) => p + DISABLED)])
						)
					)
					.run();
			await trackMods(
				instanceId,
				plan.download.map((d) => d.file)
			);
			for (const { file } of plan.download.filter((d) => d.disabled)) {
				const row = db
					.select()
					.from(installedMods)
					.where(and(eq(installedMods.instanceId, instanceId), eq(installedMods.file, file.path)))
					.get();
				if (row) setEnabledHeld(instanceId, row.id, false);
			}

			const manifest: PackManifest = {
				files: await packFileHashes(server, pack.index.files),
				overrides: Object.fromEntries(
					[...configs].map(([path, entry]) => [path, sha1Of(pack.zip.read(entry))])
				)
			};
			writeManifest(instanceId, manifest);

			if (plan.loaderChange) launchArgs(server, plan.loader);
			const needed = await requiredJavaMajor(plan.mcVersion);
			const resetJava = plan.loaderChange && inst.javaMajor !== null && inst.javaMajor < needed;

			const parts = [
				plan.download.length ? `${plan.download.length} files downloaded` : null,
				plan.remove.length ? `${plan.remove.length} removed` : null,
				plan.writeConfigs.length ? `${plan.writeConfigs.length} configs updated` : null
			].filter(Boolean);
			return {
				set: {
					mcVersion: plan.mcVersion,
					loaderVersion: plan.loaderVersion,
					javaMajor: resetJava ? null : inst.javaMajor,
					...source.recordVersion(plan),
					packName: plan.name,
					packIconUrl: pack.summary.iconUrl
				},
				message:
					`Updated ${plan.name} from ${from} to ${plan.versionNumber}` +
					(parts.length ? `: ${parts.join(', ')}.` : '.') +
					(resetJava ? ` Java is now chosen automatically, as ${needed} is needed.` : ''),
				details: plan.kept.length
					? [`Left as they were, because you changed them (${plan.kept.length}):`, ...plan.kept]
					: undefined
			};
		}
	);

	return { plan, finished };
}
