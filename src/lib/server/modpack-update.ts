import { createReadStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { claim, writeBackup } from './backups';
import { javaOverride } from './config';
import { db } from './db';
import { installedMods, instances } from './db/schema';
import { isRunning } from './files';
import { clearProgress, setProgress } from './install-progress';
import { ensureJava, requiredJavaMajor } from './java';
import { getInstance, instanceDir, serverDir, writeInstanceMeta } from './instances';
import { installServer, launchArgs, needsJavaToInstall, type Loader } from './loaders';
import { readManifest, writeManifest, type PackManifest } from './modpack-manifest';
import {
	downloadFiles,
	listModpackVersions,
	loadModpack,
	overrideEntries,
	packFileHashes,
	safeJoin,
	sha1Of,
	trackMods,
	wantsOnServer,
	type IndexFile,
	type LoadedPack,
	type ModpackVersion
} from './modpacks';
import { setEnabled } from './mods';
import { mergeStaged, removeStale } from './staged-install';
import { clearOutcome, lastOutcome, setOutcome } from './update-outcome';

export { lastOutcome };

const DISABLED = '.disabled';

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
	if (!inst?.packProjectId) throw new Error('This instance was not created from a modpack');
	const manifest = readManifest(instanceId);
	if (!manifest) throw new Error('There is no record of what the modpack installed here');
	const { summary } = pack;
	if (summary.projectId !== inst.packProjectId) throw new Error('That is a different modpack');
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

	const newFiles = new Map(pack.index.files.filter(wantsOnServer).map((f) => [f.path, f]));
	for (const [path, file] of newFiles) {
		safeJoin(server, path);
		const newHash = file.hashes.sha1;
		if (!newHash) throw new Error(`${path} has no SHA-1 in the modpack`);
		const oldHash = manifest.files[path];
		const current = onDisk(server, path);
		if (oldHash === undefined) {
			if (current === null) plan.download.push({ file, disabled: false });
			else if ((await hashFile(join(server, current))) !== newHash) plan.kept.push(path);
		} else if (oldHash !== newHash && current !== null) {
			if ((await hashFile(join(server, current))) === oldHash)
				plan.download.push({ file, disabled: current.endsWith(DISABLED) });
			else plan.kept.push(path);
		}
	}
	for (const [path, oldHash] of Object.entries(manifest.files)) {
		if (newFiles.has(path)) continue;
		const current = onDisk(server, path);
		if (current === null) continue;
		if ((await hashFile(join(server, current))) === oldHash) plan.remove.push(current);
		else plan.kept.push(path);
	}

	const newConfigs = new Map<string, string>();
	for (const [path, entry] of overrideEntries(pack.zip))
		newConfigs.set(path, sha1Of(pack.zip.read(entry)));
	for (const [path, newHash] of newConfigs) {
		const oldHash = manifest.overrides[path];
		const exists = existsSync(join(server, path));
		if (oldHash === undefined) {
			if (!exists) plan.writeConfigs.push(path);
			else if ((await hashFile(join(server, path))) !== newHash) plan.kept.push(path);
		} else if (oldHash !== newHash && exists) {
			if ((await hashFile(join(server, path))) === oldHash) plan.writeConfigs.push(path);
			else {
				plan.conflicts.push(path);
				if (options.replaceConfigs) plan.writeConfigs.push(path);
				else plan.kept.push(path);
			}
		}
	}
	for (const [path, oldHash] of Object.entries(manifest.overrides)) {
		if (newConfigs.has(path) || !existsSync(join(server, path))) continue;
		if ((await hashFile(join(server, path))) === oldHash) plan.removeConfigs.push(path);
		else plan.kept.push(path);
	}

	plan.downloadBytes = plan.download.reduce((sum, d) => sum + (d.file.fileSize ?? 0), 0);
	return plan;
}

export type ModpackInfo = {
	pack: { projectId: string; versionId: string; versionNumber: string; name: string } | null;
	versions: ModpackVersion[];
	error: string | null;
};

/** The pack an instance came from and every version of it, newest first. */
export async function modpackInfo(instanceId: number): Promise<ModpackInfo> {
	const inst = getInstance(instanceId);
	if (!inst) throw new Error('Instance not found');
	if (!inst.packProjectId || !inst.packVersionId || !readManifest(instanceId))
		return { pack: null, versions: [], error: null };
	const pack = {
		projectId: inst.packProjectId,
		versionId: inst.packVersionId,
		versionNumber: inst.packVersionNumber ?? '',
		name: inst.packName ?? inst.name
	};
	try {
		return { pack, versions: await listModpackVersions(inst.packProjectId), error: null };
	} catch (e) {
		return {
			pack,
			versions: [],
			error: e instanceof Error ? e.message : 'Could not reach Modrinth'
		};
	}
}

/** What updating to `versionId` would change, with nothing touched. */
export async function previewModpackUpdate(
	instanceId: number,
	versionId: string,
	options: { replaceConfigs: boolean }
) {
	const plan = await planModpackUpdate(instanceId, await loadModpack(versionId), options);
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
	if (!inst?.packProjectId) throw new Error('This instance was not created from a modpack');
	if (inst.installState !== 'ready') throw new Error('Wait for the install to finish');
	if (opts.versionId === inst.packVersionId) throw new Error('Already on that version');
	if (await isRunning(instanceId)) throw new Error('Stop the server before updating it');

	const pack = await loadModpack(opts.versionId);
	const plan = await planModpackUpdate(instanceId, pack, opts);
	const release = claim(instanceId, 'update');

	db.update(instances)
		.set({ installState: 'installing', installMessage: null })
		.where(eq(instances.id, instanceId))
		.run();
	clearOutcome(instanceId);
	setProgress(instanceId, { label: 'Starting', done: 0, total: 1 });

	const server = serverDir(instanceId);
	const staging = join(instanceDir(instanceId), 'server.updating');
	const from = inst.packVersionNumber ?? 'the old version';

	const finished = (async () => {
		let applied = false;
		try {
			if (opts.backup) {
				setProgress(instanceId, { label: 'Backing up the server', done: 0, total: 1 });
				await writeBackup(
					instanceId,
					'before-update',
					`Before updating to ${plan.name} ${plan.versionNumber}`
				);
			}

			rmSync(staging, { recursive: true, force: true });
			mkdirSync(staging, { recursive: true });
			if (plan.loaderChange) {
				setProgress(instanceId, { label: 'Installing the new server', done: 0, total: 1 });
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

			setProgress(instanceId, { label: 'Replacing the old files', done: 0, total: 1 });
			applied = true;
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
				if (row) setEnabled(instanceId, row.id, false);
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
			const row = db
				.update(instances)
				.set({
					mcVersion: plan.mcVersion,
					loaderVersion: plan.loaderVersion,
					javaMajor: resetJava ? null : inst.javaMajor,
					packVersionId: plan.versionId,
					packVersionNumber: plan.versionNumber,
					packName: plan.name,
					installState: 'ready',
					installMessage: null
				})
				.where(eq(instances.id, instanceId))
				.returning()
				.get();
			writeInstanceMeta(row);

			const parts = [
				plan.download.length ? `${plan.download.length} files downloaded` : null,
				plan.remove.length ? `${plan.remove.length} removed` : null,
				plan.writeConfigs.length ? `${plan.writeConfigs.length} configs updated` : null
			].filter(Boolean);
			setOutcome(instanceId, {
				ok: true,
				message:
					`Updated ${plan.name} from ${from} to ${plan.versionNumber}` +
					(parts.length ? `: ${parts.join(', ')}.` : '.') +
					(resetJava ? ` Java is now chosen automatically, as ${needed} is needed.` : ''),
				details: plan.kept.length
					? [`Left as they were, because you changed them (${plan.kept.length}):`, ...plan.kept]
					: undefined
			});
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			console.error(`[modpack] update of #${instanceId} failed: ${message}`);
			// before the files are replaced the server is untouched and can start as before
			db.update(instances)
				.set(
					applied
						? { installState: 'failed', installMessage: message.slice(0, 500) }
						: { installState: 'ready', installMessage: null }
				)
				.where(eq(instances.id, instanceId))
				.run();
			setOutcome(instanceId, {
				ok: false,
				message: applied ? `The update stopped part way: ${message}` : message
			});
		} finally {
			rmSync(staging, { recursive: true, force: true });
			clearProgress(instanceId);
			release();
		}
	})();

	return { plan, finished };
}
