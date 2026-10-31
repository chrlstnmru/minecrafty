import { and, eq } from 'drizzle-orm';

import { updateKind } from '../versions';
import { javaOverride } from './config';
import { db } from './db';
import { installedMods } from './db/schema';
import { runUpdate } from './instance-job';
import { getInstance, serverDir } from './instances';
import { ensureJava, requiredJavaMajor } from './java';
import { isRunning } from './live-server';
import {
	getMinecraftVersions,
	installServer,
	isKnownVersion,
	latestBuild,
	launchArgs,
	loaderBuilds,
	needsJavaToInstall,
	type Loader
} from './loaders';
import { mergeStaged, removeStale } from './staged-install';

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

/** The builds an instance could move to on `mcVersion`, newest first; empty for vanilla. */
export async function buildsFor(instanceId: number, mcVersion: string) {
	const inst = getInstance(instanceId);
	if (!inst) throw new Error('Instance not found');
	return loaderBuilds(inst.loader as Loader, mcVersion);
}

/**
 * Starts moving an instance to `build` of `mcVersion`, or its newest build when none is given
 * (the current version for a plain build update). The checks run now and throw; the install runs in the background while the
 * instance shows as installing, and `finished` settles when it is over. The new files are built
 * beside the server and swapped in only after the installer succeeded, so a failed install
 * leaves the old server as it was.
 */
export async function startLoaderUpdate(
	instanceId: number,
	opts: { mcVersion: string; build?: string; backup: boolean }
) {
	const inst = getInstance(instanceId);
	if (!inst) throw new Error('Instance not found');
	const loader = inst.loader as Loader;
	if (inst.installState !== 'ready') throw new Error('Wait for the install to finish');
	if (await isRunning(instanceId)) throw new Error('Stop the server before updating it');
	if (!(await isKnownVersion(loader, opts.mcVersion)))
		throw new Error(`${loader} does not support Minecraft ${opts.mcVersion}`);

	let build: string | null | undefined;
	if (opts.build && loader !== 'vanilla') {
		if (!(await loaderBuilds(loader, opts.mcVersion)).includes(opts.build))
			throw new Error(`${loader} has no build ${opts.build} for Minecraft ${opts.mcVersion}`);
		build = opts.build;
	} else build = (await latestBuild(loader, opts.mcVersion)) ?? null;
	if (build === undefined || (loader !== 'vanilla' && build === null))
		throw new Error(`There is no ${loader} build for Minecraft ${opts.mcVersion}`);
	if (opts.mcVersion === inst.mcVersion && build === inst.loaderVersion)
		throw new Error('Already up to date');

	const from = { mcVersion: inst.mcVersion, loaderVersion: inst.loaderVersion };
	const to = { mcVersion: opts.mcVersion, loaderVersion: build };
	const describe = (v: { mcVersion: string; loaderVersion: string | null }) =>
		`${loader} ${v.mcVersion}${v.loaderVersion ? ` (${v.loaderVersion})` : ''}`;

	const finished = runUpdate(
		instanceId,
		{ kind: 'loader', backup: opts.backup ? `Before updating to ${describe(to)}` : null },
		async ({ staging, progress, commit }) => {
			progress('Installing the new server');
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

			progress('Replacing the old server');
			commit();
			removeStale(serverDir(instanceId), loader);
			mergeStaged(serverDir(instanceId), staging);
			launchArgs(serverDir(instanceId), loader);

			// a Java version chosen by hand may be too old for the new Minecraft version
			const needed = await requiredJavaMajor(to.mcVersion);
			const resetJava = inst.javaMajor !== null && inst.javaMajor < needed;
			return {
				set: {
					mcVersion: to.mcVersion,
					loaderVersion: to.loaderVersion,
					javaMajor: resetJava ? null : inst.javaMajor
				},
				message:
					`Updated from ${describe(from)} to ${describe(to)}.` +
					(resetJava ? ` Java is now chosen automatically, as ${needed} is needed.` : '')
			};
		}
	);

	return { from, to, kind: updateKind(from.mcVersion, to.mcVersion), finished };
}
