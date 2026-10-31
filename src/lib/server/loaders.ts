import { existsSync, readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { compareVersions } from '../versions';
import { downloadFile, type Download, type Hash, type OnProgress } from './download';

export { LOADERS, type Loader } from '../loader-list';
import type { Loader } from '../loader-list';

const MOJANG_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const PAPER = 'https://fill.papermc.io/v3/projects/paper';
const PURPUR = 'https://api.purpurmc.org/v2/purpur';
const FABRIC = 'https://meta.fabricmc.net/v2/versions';
const QUILT = 'https://meta.quiltmc.org/v3/versions';
const FORGE_PROMOS =
	'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const NEOFORGE_API =
	'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge';
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
	const value = await load();
	cache.set(key, { at: Date.now(), value });
	return value;
}

async function getJson<T>(url: string): Promise<T> {
	const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
	if (!res.ok) throw new Error(`${url} responded ${res.status}`);
	return res.json() as Promise<T>;
}

const RELEASE = /^\d+(\.\d+)*$/;

const newestFirst = (versions: Iterable<string>) =>
	[...new Set(versions)].filter((v) => RELEASE.test(v)).sort(compareVersions);

type MetaVersion = { version: string; stable: boolean };

// Quilt marks loader prereleases with a suffix instead of a stable flag
const stableLoader = (versions: { version: string }[]) =>
	versions.find((v) => !v.version.includes('-'))?.version ?? versions[0]?.version;

const forgePromos = () =>
	cached(
		'forge:promos',
		async () => (await getJson<{ promos: Record<string, string> }>(FORGE_PROMOS)).promos
	);

/** NeoForge versions are keyed by the Minecraft version they target: 21.4.140 is 1.21.4. */
function neoforgeMinecraft(version: string) {
	const parts = version.split('.').map(Number);
	if (parts.some(Number.isNaN)) return null;
	const [a, b, c] = parts;
	// 26.3.0.99 -> 26.3, 26.1.2.5 -> 26.1.2 (new scheme has four numbers)
	if (a >= 26) return parts.length === 4 ? (c === 0 ? `${a}.${b}` : `${a}.${b}.${c}`) : null;
	return parts.length === 3 ? (b === 0 ? `1.${a}` : `1.${a}.${b}`) : null;
}

/** Stable NeoForge versions grouped by Minecraft version, newest first. */
const neoforgeVersions = () =>
	cached('neoforge:versions', async () => {
		const { versions } = await getJson<{ versions: string[] }>(NEOFORGE_API);
		const byMc = new Map<string, string[]>();
		for (const v of versions) {
			if (!/^\d+(\.\d+){2,3}$/.test(v)) continue; // skips -beta and snapshot-style builds
			const mc = neoforgeMinecraft(v);
			if (mc) byMc.set(mc, [...(byMc.get(mc) ?? []), v]);
		}
		for (const list of byMc.values()) list.sort(compareVersions);
		return byMc;
	});

export function getMinecraftVersions(loader: Loader): Promise<string[]> {
	return cached(`versions:${loader}`, async () => {
		switch (loader) {
			case 'vanilla': {
				const m = await getJson<{ versions: { id: string; type: string }[] }>(MOJANG_MANIFEST);
				return m.versions.filter((v) => v.type === 'release').map((v) => v.id);
			}
			case 'paper': {
				const p = await getJson<{ versions: Record<string, string[]> }>(PAPER);
				return newestFirst(Object.values(p.versions).flat());
			}
			case 'purpur': {
				const p = await getJson<{ versions: string[] }>(PURPUR);
				return newestFirst(p.versions);
			}
			case 'fabric':
			case 'quilt': {
				const games = await getJson<MetaVersion[]>(`${loader === 'fabric' ? FABRIC : QUILT}/game`);
				return newestFirst(games.filter((g) => g.stable).map((g) => g.version));
			}
			case 'forge': {
				const promos = await forgePromos();
				return newestFirst(Object.keys(promos).map((k) => k.replace(/-(latest|recommended)$/, '')));
			}
			case 'neoforge':
				return newestFirst((await neoforgeVersions()).keys());
		}
	});
}

type PaperBuild = {
	id: number;
	channel: string;
	downloads: Record<string, { url: string; checksums: { sha256: string } }>;
};

const paperBuilds = (mc: string) =>
	cached(`paper:${mc}`, () => getJson<PaperBuild[]>(`${PAPER}/versions/${mc}/builds`));

/** Newest build for a Minecraft version (stable channel preferred for Paper). Vanilla has none. */
export async function latestBuild(loader: Loader, mc: string): Promise<string | null | undefined> {
	switch (loader) {
		case 'vanilla':
			return null;
		case 'paper': {
			const builds = (await paperBuilds(mc)).toSorted((a, b) => b.id - a.id);
			const build = builds.find((b) => b.channel === 'STABLE') ?? builds[0];
			if (!build) throw new Error(`No Paper build for ${mc}`);
			return String(build.id);
		}
		case 'purpur': {
			const v = await cached(`purpur:${mc}`, () =>
				getJson<{ builds: { latest: string } }>(`${PURPUR}/${mc}`)
			);
			return v.builds.latest;
		}
		case 'fabric':
			return stableLoader(
				(await cached('fabric:loader', () => getJson<MetaVersion[]>(`${FABRIC}/loader`))).filter(
					(l) => l.stable
				)
			);
		case 'quilt':
			return stableLoader(
				await cached('quilt:loader', () => getJson<{ version: string }[]>(`${QUILT}/loader`))
			);
		case 'forge': {
			const promos = await forgePromos();
			return promos[`${mc}-recommended`] ?? promos[`${mc}-latest`];
		}
		case 'neoforge':
			return (await neoforgeVersions()).get(mc)?.[0];
	}
}

/** Every stable build of a loader for a Minecraft version, newest first, for picking one by hand. Vanilla has none. */
export async function loaderBuilds(loader: Loader, mc: string): Promise<string[]> {
	switch (loader) {
		case 'vanilla':
			return [];
		case 'paper': {
			const builds = (await paperBuilds(mc)).toSorted((a, b) => b.id - a.id);
			const stable = builds.filter((b) => b.channel === 'STABLE');
			return (stable.length ? stable : builds).map((b) => String(b.id));
		}
		case 'purpur': {
			const v = await cached(`purpur:${mc}`, () =>
				getJson<{ builds: { latest: string; all?: string[] } }>(`${PURPUR}/${mc}`)
			);
			return (v.builds.all ?? [v.builds.latest]).toReversed();
		}
		case 'fabric':
			return newestFirst(
				(await cached('fabric:loader', () => getJson<MetaVersion[]>(`${FABRIC}/loader`))).map(
					(l) => l.version
				)
			);
		case 'quilt':
			return newestFirst(
				(await cached('quilt:loader', () => getJson<{ version: string }[]>(`${QUILT}/loader`))).map(
					(l) => l.version
				)
			);
		case 'forge': {
			const xml = await cached('forge:maven', async () => {
				const res = await fetch(`${FORGE_MAVEN}/maven-metadata.xml`, {
					signal: AbortSignal.timeout(15_000)
				});
				if (!res.ok) throw new Error(`Forge's version list responded ${res.status}`);
				return res.text();
			});
			// entries read <minecraft>-<forge>, such as 1.20.1-47.3.0
			const prefix = `${mc}-`;
			return newestFirst(
				[...xml.matchAll(/<version>([^<]+)<\/version>/g)]
					.map((m) => m[1])
					.filter((v) => v.startsWith(prefix))
					.map((v) => v.slice(prefix.length))
			);
		}
		case 'neoforge':
			return (await neoforgeVersions()).get(mc) ?? [];
	}
}

export async function isKnownVersion(loader: Loader, mc: string) {
	return (await getMinecraftVersions(loader)).includes(mc);
}

async function sha1Sidecar(url: string): Promise<Hash> {
	const res = await fetch(`${url}.sha1`, { signal: AbortSignal.timeout(15_000) });
	if (!res.ok) throw new Error(`Missing checksum for ${url}`);
	return { algo: 'sha1', value: (await res.text()).trim() };
}

async function resolveDownload(loader: Loader, mc: string, build?: string): Promise<Download> {
	switch (loader) {
		case 'vanilla': {
			const m = await getJson<{ versions: { id: string; url: string }[] }>(MOJANG_MANIFEST);
			const entry = m.versions.find((v) => v.id === mc);
			if (!entry) throw new Error('Unknown Minecraft version');
			const v = await getJson<{ downloads: { server?: { url: string; sha1: string } } }>(entry.url);
			if (!v.downloads.server) throw new Error(`${mc} has no server download`);
			return {
				url: v.downloads.server.url,
				hash: { algo: 'sha1', value: v.downloads.server.sha1 }
			};
		}
		case 'paper': {
			const b = (await paperBuilds(mc)).find((x) => String(x.id) === build);
			const d = b?.downloads['server:default'];
			if (!d) throw new Error('Unknown Paper build');
			return { url: d.url, hash: { algo: 'sha256', value: d.checksums.sha256 } };
		}
		case 'purpur': {
			const info = await getJson<{ md5: string }>(`${PURPUR}/${mc}/${build}`);
			return { url: `${PURPUR}/${mc}/${build}/download`, hash: { algo: 'md5', value: info.md5 } };
		}
		case 'fabric': {
			// the launcher jar fetches the vanilla server itself on first run
			const installers = await cached('fabric:installer', () =>
				getJson<MetaVersion[]>(`${FABRIC}/installer`)
			);
			const installer = installers.find((i) => i.stable)?.version;
			if (!installer || !build) throw new Error('Could not resolve Fabric versions');
			return { url: `${FABRIC}/loader/${mc}/${build}/${installer}/server/jar` };
		}
		case 'quilt': {
			const installers = await cached('quilt:installer', () =>
				getJson<{ url: string }[]>(`${QUILT}/installer`)
			);
			const url = installers[0]?.url;
			if (!url) throw new Error('Could not resolve the Quilt installer');
			// the hashes in Quilt's meta API do not match the published jar; Maven's do
			return { url, hash: await sha1Sidecar(url) };
		}
		case 'forge': {
			const url = `${FORGE_MAVEN}/${mc}-${build}/forge-${mc}-${build}-installer.jar`;
			return { url, hash: await sha1Sidecar(url) };
		}
		case 'neoforge': {
			const url = `${NEOFORGE_MAVEN}/${build}/neoforge-${build}-installer.jar`;
			return { url, hash: await sha1Sidecar(url) };
		}
	}
}

/** Loaders whose download is an installer that has to be run with Java. */
export const needsJavaToInstall = (loader: Loader) =>
	loader === 'quilt' || loader === 'forge' || loader === 'neoforge';

async function runInstaller(java: string, args: string[], cwd: string) {
	const proc = Bun.spawn([java, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
	const timer = setTimeout(() => proc.kill('SIGKILL'), 10 * 60_000);
	const [out, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited
	]);
	clearTimeout(timer);
	if (code !== 0) {
		const tail = (err || out).trim().split('\n').slice(-6).join('\n');
		throw new Error(`Installer failed (exit ${code}): ${tail}`);
	}
}

/**
 * Puts a runnable server into `serverDir`: a plain jar for most loaders, or the output of the
 * loader's installer for Quilt, Forge and NeoForge (`java` is required for those).
 */
export async function installServer(opts: {
	serverDir: string;
	loader: Loader;
	mc: string;
	build?: string;
	java?: string;
	/** told what is happening: the download with its byte counts, then the installer's run */
	report?: (step: 'downloading' | 'installing', done?: number, total?: number) => void;
}) {
	const { serverDir, loader, mc, build, java, report } = opts;
	const onBytes: OnProgress = (done, total) => report?.('downloading', done, total);
	const download = await resolveDownload(loader, mc, build);
	if (!needsJavaToInstall(loader)) {
		await downloadFile(join(serverDir, 'server.jar'), download, onBytes);
		return;
	}
	if (!java) throw new Error(`Installing ${loader} needs Java`);

	const installer = join(serverDir, 'installer.jar');
	try {
		await downloadFile(installer, download, onBytes);
		report?.('installing');
		const args =
			loader === 'quilt'
				? [
						'-jar',
						installer,
						'install',
						'server',
						mc,
						build ?? '', // positional: install server <minecraft> <loader>,
						'--download-server',
						'--install-dir=.'
					]
				: ['-jar', installer, '--installServer'];
		await runInstaller(java, args, serverDir);
		launchArgs(serverDir, loader); // throws if the installer did not produce a runnable server
	} finally {
		await rm(installer, { force: true });
		await rm(`${installer}.log`, { force: true });
	}
}

/** Java arguments that follow the memory flags: which jar (or argument file) starts the server. */
export function launchArgs(serverDir: string, loader: Loader): string[] {
	const jar = (name: string) => {
		if (!existsSync(join(serverDir, name))) throw new Error(`${name} is missing`);
		return ['-jar', name, 'nogui'];
	};
	switch (loader) {
		case 'quilt':
			return jar('quilt-server-launch.jar');
		case 'forge':
		case 'neoforge': {
			// Forge/NeoForge 1.17+ ship an argument file instead of a launcher jar
			const argsFile = process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt';
			const found = findFile(join(serverDir, 'libraries'), argsFile);
			if (found) return [`@${relative(serverDir, found).replaceAll('\\', '/')}`, 'nogui'];
			// older Forge: a launcher jar named forge-<version>.jar (or ...-universal.jar)
			const legacy = readdirSync(serverDir).find((f) => /^forge-.*\.jar$/.test(f));
			if (legacy) return jar(legacy);
			throw new Error('The installer did not produce a runnable server');
		}
		default:
			return jar('server.jar');
	}
}

function findFile(dir: string, name: string, depth = 0): string | null {
	if (depth > 8) return null;
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return null;
	}
	for (const e of entries) {
		const full = join(dir, e.name);
		if (e.isFile() && e.name === name) return full;
		if (e.isDirectory()) {
			const hit = findFile(full, name, depth + 1);
			if (hit) return hit;
		}
	}
	return null;
}
