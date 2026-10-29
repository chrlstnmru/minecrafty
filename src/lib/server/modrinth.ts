const API = 'https://api.modrinth.com/v2';

// Modrinth asks every client to identify itself
const headers = { 'User-Agent': 'minecrafty/0.0.1 (self-hosted Minecraft server panel)' };

export type ModrinthHit = {
	project_id: string;
	slug: string;
	title: string;
	description: string;
	icon_url: string | null;
	author: string;
	downloads: number;
	categories: string[];
	client_side: string;
	server_side: string;
};

export type ModrinthFile = {
	filename: string;
	url: string;
	size: number;
	primary: boolean;
	hashes: { sha1: string; sha512: string };
};

export type ModrinthVersion = {
	id: string;
	project_id: string;
	version_number: string;
	date_published: string;
	version_type: 'release' | 'beta' | 'alpha';
	files: ModrinthFile[];
	dependencies: {
		project_id: string | null;
		version_id: string | null;
		dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded';
	}[];
};

export type ModrinthProject = {
	id: string;
	title: string;
	icon_url: string | null;
	server_side: string;
};

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
	const url = new URL(API + path);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
	if (res.status === 429) throw new Error('Modrinth is rate limiting requests, try again shortly');
	if (!res.ok) throw new Error(`Modrinth responded ${res.status}`);
	return res.json() as Promise<T>;
}

export async function searchProjects(opts: {
	query: string;
	/** empty means no loader filter (resource packs, shader packs) */
	loaders: string[];
	/** omit to search across Minecraft versions (modpacks carry their own) */
	mc?: string;
	/** Modrinth project type: mod, resourcepack, modpack */
	type?: string;
	/** plugins have no `mod` project type on Modrinth, so the type facet is left out for them */
	plugins?: boolean;
	/** false for projects used on the client side (resource packs, shaders) */
	serverSide?: boolean;
	offset?: number;
	limit?: number;
}) {
	const facets = [
		...(opts.plugins ? [] : [[`project_type:${opts.type ?? 'mod'}`]]),
		...(opts.loaders.length ? [opts.loaders.map((l) => `categories:${l}`)] : []),
		...(opts.mc ? [[`versions:${opts.mc}`]] : []),
		// skip projects that only work on the client
		...(opts.serverSide === false ? [] : [['server_side:required', 'server_side:optional']])
	];
	return get<{ hits: ModrinthHit[]; total_hits: number }>('/search', {
		query: opts.query,
		facets: JSON.stringify(facets),
		limit: String(opts.limit ?? 20),
		offset: String(opts.offset ?? 0)
	});
}

/** Versions of a project for these loaders and Minecraft version, newest first. */
export function listVersions(projectId: string, loaders: string[], mc?: string) {
	return get<ModrinthVersion[]>(`/project/${encodeURIComponent(projectId)}/version`, {
		...(loaders.length ? { loaders: JSON.stringify(loaders) } : {}),
		...(mc ? { game_versions: JSON.stringify([mc]) } : {})
	});
}

/** Newest version for each installed file (keyed by sha512), for these loaders and Minecraft version. */
export async function latestVersions(hashes: string[], loaders: string[], mc: string) {
	if (!hashes.length) return {};
	const res = await fetch(`${API}/version_files/update`, {
		method: 'POST',
		headers: { ...headers, 'Content-Type': 'application/json' },
		body: JSON.stringify({ hashes, algorithm: 'sha512', loaders, game_versions: [mc] }),
		signal: AbortSignal.timeout(15_000)
	});
	if (res.status === 429) throw new Error('Modrinth is rate limiting requests, try again shortly');
	if (!res.ok) throw new Error(`Modrinth responded ${res.status}`);
	return (await res.json()) as Record<string, ModrinthVersion>;
}

/** The version that each file hash (sha512) belongs to; files Modrinth does not know are absent. */
export async function versionsByHashes(hashes: string[]) {
	if (!hashes.length) return {};
	const res = await fetch(`${API}/version_files`, {
		method: 'POST',
		headers: { ...headers, 'Content-Type': 'application/json' },
		body: JSON.stringify({ hashes, algorithm: 'sha512' }),
		signal: AbortSignal.timeout(30_000)
	});
	if (res.status === 429) throw new Error('Modrinth is rate limiting requests, try again shortly');
	if (!res.ok) throw new Error(`Modrinth responded ${res.status}`);
	return (await res.json()) as Record<string, ModrinthVersion>;
}

export function getVersion(versionId: string) {
	return get<ModrinthVersion>(`/version/${encodeURIComponent(versionId)}`);
}

export async function getProjects(ids: string[]) {
	if (!ids.length) return [];
	return get<ModrinthProject[]>('/projects', { ids: JSON.stringify(ids) });
}
