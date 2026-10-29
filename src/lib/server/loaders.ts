import { rename, rm } from 'node:fs/promises';

export const LOADERS = ['vanilla', 'paper', 'purpur'] as const;
export type Loader = (typeof LOADERS)[number];

type Download = { url: string; hash?: { algo: 'sha1' | 'sha256' | 'md5'; value: string } };

const MOJANG_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const PAPER = 'https://fill.papermc.io/v3/projects/paper';
const PURPUR = 'https://api.purpurmc.org/v2/purpur';

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

// newest first; works for both 1.21.4 and the newer 26.3 style
function compareVersions(a: string, b: string) {
	const pa = a.split('.').map(Number);
	const pb = b.split('.').map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pb[i] ?? 0) - (pa[i] ?? 0);
		if (d) return d;
	}
	return 0;
}

const newestFirst = (versions: Iterable<string>) =>
	[...new Set(versions)].filter((v) => RELEASE.test(v)).sort(compareVersions);

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
export async function latestBuild(loader: Loader, mc: string): Promise<string | null> {
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
	}
}

export async function isKnownVersion(loader: Loader, mc: string) {
	return (await getMinecraftVersions(loader)).includes(mc);
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
	}
}

/** Downloads the server jar to `dest`, verifying the upstream checksum when one is published. */
export async function downloadServerJar(dest: string, loader: Loader, mc: string, build?: string) {
	const { url, hash } = await resolveDownload(loader, mc, build);
	const res = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) });
	if (!res.ok) throw new Error(`Download failed (${res.status})`);

	const tmp = `${dest}.part`;
	try {
		await Bun.write(tmp, res);
		if (hash) {
			const actual = new Bun.CryptoHasher(hash.algo)
				.update(await Bun.file(tmp).arrayBuffer())
				.digest('hex');
			if (actual !== hash.value) throw new Error('Downloaded jar failed checksum verification');
		}
		await rename(tmp, dest);
	} catch (e) {
		await rm(tmp, { force: true });
		throw e;
	}
}
