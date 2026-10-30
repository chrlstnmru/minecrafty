import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { claim, writeBackup } from './backups';
import { javaOverride } from './config';
import { db } from './db';
import { installedMods, instances } from './db/schema';
import { isRunning } from './files';
import { clearProgress, setProgress } from './install-progress';
import { updateKind } from '../versions';
import { ensureJava, requiredJavaMajor } from './java';
import { getInstance, instanceDir, serverDir, writeInstanceMeta } from './instances';
import {
	getMinecraftVersions,
	installServer,
	isKnownVersion,
	latestBuild,
	launchArgs,
	needsJavaToInstall,
	type Loader
} from './loaders';

// Top-level names a loader's installer produces that a newer install must not leave behind: an
// old forge-*.jar or libraries/ folder would be picked up by launchArgs ahead of the new one.
const STALE: Record<Loader, RegExp[]> = {
	vanilla: [],
	paper: [],
	purpur: [],
	fabric: [],
	quilt: [/^libraries$/, /^quilt-server-launch\.jar$/],
	forge: [/^libraries$/, /^forge-.*\.jar$/, /^minecraft_server.*\.jar$/, /^run\.(sh|bat)$/],
	neoforge: [/^libraries$/, /^minecraft_server.*\.jar$/, /^run\.(sh|bat)$/]
};

// files a loader writes once and the user then edits; an update must not overwrite them
const USER_FILES = new Set(['user_jvm_args.txt']);

export type UpdateOutcome = { ok: boolean; message: string; at: number };

// the result of the last update per instance; lost on restart, like install progress
const outcomes = new Map<number, UpdateOutcome>();
export const lastOutcome = (instanceId: number) => outcomes.get(instanceId) ?? null;

export type LoaderInfo = {
	loader: Loader;
	mcVersion: string;
	loaderVersion: string | null;
	/** the newest build for the current Minecraft version, or null when there is none or it could not be fetched */
	latest: string | null;
	/** Minecraft versions this loader can run, newest first */
	versions: string[];
	/** set when the version service could not be reached */
	error: string | null;
	mods: number;
};

export async function loaderInfo(instanceId: number): Promise<LoaderInfo> {
	const inst = getInstance(instanceId);
	if (!inst) throw new Error('Instance not found');
	const loader = inst.loader as Loader;
	let latest: string | null = null;
	let versions: string[] = [];
	let error: string | null = null;
	try {
		[latest, versions] = await Promise.all([
			latestBuild(loader, inst.mcVersion).then((build) => build ?? null),
			getMinecraftVersions(loader)
		]);
	} catch (e) {
		error = e instanceof Error ? e.message : 'Could not reach the version service';
	}
	const mods = db
		.select()
		.from(installedMods)
		.where(and(eq(installedMods.instanceId, instanceId), eq(installedMods.kind, 'mod')))
		.all().length;
	return {
		loader,
		mcVersion: inst.mcVersion,
		loaderVersion: inst.loaderVersion,
		latest,
		versions,
		error,
		mods
	};
}

/** Replaces what the loader installed in `server` with what is in `staging`, then deletes `staging`. */
function swapIn(server: string, staging: string, loader: Loader) {
	for (const name of readdirSync(server))
		if (STALE[loader].some((pattern) => pattern.test(name)))
			rmSync(join(server, name), { recursive: true, force: true });
	for (const name of readdirSync(staging)) {
		if (USER_FILES.has(name) && existsSync(join(server, name))) continue;
		rmSync(join(server, name), { recursive: true, force: true });
		renameSync(join(staging, name), join(server, name));
	}
	rmSync(staging, { recursive: true, force: true });
}

/**
 * Starts moving an instance to the newest build of `mcVersion` (the current version for a plain
 * build update). The checks run now and throw; the install runs in the background while the
 * instance shows as installing, and `finished` settles when it is over. The new files are built
 * beside the server and swapped in only after the installer succeeded, so a failed install
 * leaves the old server as it was.
 */
export async function startLoaderUpdate(
	instanceId: number,
	opts: { mcVersion: string; backup: boolean }
) {
	const inst = getInstance(instanceId);
	if (!inst) throw new Error('Instance not found');
	const loader = inst.loader as Loader;
	if (inst.installState !== 'ready') throw new Error('Wait for the install to finish');
	if (await isRunning(instanceId)) throw new Error('Stop the server before updating it');
	if (!(await isKnownVersion(loader, opts.mcVersion)))
		throw new Error(`${loader} does not support Minecraft ${opts.mcVersion}`);

	const build = (await latestBuild(loader, opts.mcVersion)) ?? null;
	if (build === undefined || (loader !== 'vanilla' && build === null))
		throw new Error(`There is no ${loader} build for Minecraft ${opts.mcVersion}`);
	if (opts.mcVersion === inst.mcVersion && build === inst.loaderVersion)
		throw new Error('Already up to date');

	const release = claim(instanceId, 'update');
	const from = { mcVersion: inst.mcVersion, loaderVersion: inst.loaderVersion };
	const to = { mcVersion: opts.mcVersion, loaderVersion: build };
	const describe = (v: { mcVersion: string; loaderVersion: string | null }) =>
		`${loader} ${v.mcVersion}${v.loaderVersion ? ` (${v.loaderVersion})` : ''}`;

	db.update(instances)
		.set({ installState: 'installing', installMessage: null })
		.where(eq(instances.id, instanceId))
		.run();
	outcomes.delete(instanceId);
	setProgress(instanceId, { label: 'Starting', done: 0, total: 1 });

	const finished = (async () => {
		const staging = join(instanceDir(instanceId), 'server.updating');
		let swapped = false;
		try {
			if (opts.backup) {
				setProgress(instanceId, { label: 'Backing up the server', done: 0, total: 1 });
				await writeBackup(instanceId, 'before-update', `Before updating to ${describe(to)}`);
			}

			setProgress(instanceId, { label: 'Installing the new server', done: 0, total: 1 });
			rmSync(staging, { recursive: true, force: true });
			mkdirSync(staging, { recursive: true });
			const java = needsJavaToInstall(loader)
				? (javaOverride ?? (await ensureJava(await requiredJavaMajor(to.mcVersion))))
				: undefined;
			await installServer({
				serverDir: staging,
				loader,
				mc: to.mcVersion,
				build: build ?? undefined,
				java
			});

			setProgress(instanceId, { label: 'Replacing the old server', done: 0, total: 1 });
			swapped = true;
			swapIn(serverDir(instanceId), staging, loader);
			launchArgs(serverDir(instanceId), loader);

			// a Java version chosen by hand may be too old for the new Minecraft version
			const needed = await requiredJavaMajor(to.mcVersion);
			const resetJava = inst.javaMajor !== null && inst.javaMajor < needed;
			const row = db
				.update(instances)
				.set({
					mcVersion: to.mcVersion,
					loaderVersion: to.loaderVersion,
					javaMajor: resetJava ? null : inst.javaMajor,
					installState: 'ready',
					installMessage: null
				})
				.where(eq(instances.id, instanceId))
				.returning()
				.get();
			writeInstanceMeta(row);
			outcomes.set(instanceId, {
				ok: true,
				message:
					`Updated from ${describe(from)} to ${describe(to)}.` +
					(resetJava ? ` Java is now chosen automatically, as ${needed} is needed.` : ''),
				at: Date.now()
			});
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			console.error(`[loader] update of #${instanceId} failed: ${message}`);
			// before the swap the server is untouched and can start as before; after it, it may not
			db.update(instances)
				.set(
					swapped
						? { installState: 'failed', installMessage: message.slice(0, 500) }
						: { installState: 'ready', installMessage: null }
				)
				.where(eq(instances.id, instanceId))
				.run();
			outcomes.set(instanceId, {
				ok: false,
				message: swapped ? `The update stopped part way: ${message}` : message,
				at: Date.now()
			});
		} finally {
			rmSync(staging, { recursive: true, force: true });
			clearProgress(instanceId);
			release();
		}
	})();

	return { from, to, kind: updateKind(from.mcVersion, to.mcVersion), finished };
}
