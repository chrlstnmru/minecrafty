// The root side of a one-click update, run as `minecrafty self-update` by the minecrafty-update
// service when the panel leaves a request in its data folder. The panel cannot replace its own
// program (it runs as an unprivileged user), so it only asks; this checks the request, downloads
// the release, verifies it against the release's checksums and swaps it in.
//
// It trusts nothing in the request but a version and a channel: the repository comes from the
// root-owned settings, and only a release newer than the running one is installed (a full release,
// unless the request is on the pre-release channel), so a compromised panel cannot use it to
// downgrade to an older, weaker build.
import { lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { compareReleases, isReleaseTag, isStableTag } from '../release-version';
import { dataDir } from './config';

export type UpdateStatus = {
	state: 'installing' | 'done' | 'failed';
	version: string;
	message?: string;
	at: number;
};

/** Where the panel leaves a request: its own data folder, the one place it can write. */
export const updateRequestFile = () => join(dataDir, 'update-request');
/** Next to the program, which only root can write, so the panel can read it but not fake it. */
export const updateStatusFile = (binary = process.execPath) =>
	join(dirname(binary), 'update-status.json');

/** The release file for this machine, as the release workflow names it. */
export function releaseAsset(platform = process.platform, arch = process.arch) {
	if (platform === 'linux' && arch === 'x64') return 'minecrafty-linux-x64';
	if (platform === 'linux' && arch === 'arm64') return 'minecrafty-linux-arm64';
	if (platform === 'win32' && arch === 'x64') return 'minecrafty-windows-x64.exe';
	throw new Error(`No release is built for ${platform} ${arch}`);
}

/** `fetch`, or a stand-in for it in tests. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export type ApplyOptions = {
	requestFile: string;
	statusFile: string;
	binary: string;
	repo: string;
	current: string;
	asset: string;
	restart: () => Promise<void>;
	fetch?: Fetch;
};

function writeStatus(file: string, status: UpdateStatus) {
	const tmp = `${file}.tmp`;
	writeFileSync(tmp, JSON.stringify(status));
	renameSync(tmp, file);
}

async function download(get: Fetch, url: string) {
	const res = await get(url, { signal: AbortSignal.timeout(5 * 60_000) });
	if (!res.ok) throw new Error(`${url} responded ${res.status}`);
	return new Uint8Array(await res.arrayBuffer());
}

/** Handles one request, if there is one; returns what it did, or null when there was none. */
export async function applyUpdate(o: ApplyOptions): Promise<UpdateStatus | null> {
	let stat;
	try {
		stat = lstatSync(o.requestFile);
	} catch {
		return null;
	}
	// read once and remove it first, so the path unit does not start this again for the same request
	const raw = stat.isFile() && stat.size <= 1024 ? readFileSync(o.requestFile, 'utf8') : '';
	rmSync(o.requestFile, { force: true });

	let version = '';
	let prerelease = false;
	try {
		const request = JSON.parse(raw) as { version?: unknown; channel?: unknown };
		version = String(request.version ?? '');
		prerelease = request.channel === 'prerelease';
	} catch {
		// reported below as an unreadable request
	}
	const fail = (message: string): UpdateStatus => {
		const status: UpdateStatus = { state: 'failed', version, message, at: Date.now() };
		writeStatus(o.statusFile, status);
		return status;
	};
	if (!(prerelease ? isReleaseTag(version) : isStableTag(version)))
		return fail('The request did not name a release');
	if (!((compareReleases(version, o.current) ?? 0) > 0))
		return fail(`${version} is not newer than ${o.current}`);

	writeStatus(o.statusFile, { state: 'installing', version, at: Date.now() });
	try {
		const get: Fetch = o.fetch ?? fetch;
		const base = `https://github.com/${o.repo}/releases/download/${version}`;
		const sums = new TextDecoder().decode(await download(get, `${base}/SHA256SUMS`));
		const expected = sums
			.split('\n')
			.map((line) => line.trim().split(/\s+/))
			.find(([, name]) => name === o.asset)?.[0];
		if (!expected) throw new Error(`${o.asset} is not in the release's checksums`);
		const bytes = await download(get, `${base}/${o.asset}`);
		const actual = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
		if (actual !== expected.toLowerCase())
			throw new Error('The download does not match its checksum; not installing it');

		// a rename over the running program is safe: the old process keeps its open file
		const next = `${o.binary}.new`;
		writeFileSync(next, bytes, { mode: 0o755 });
		renameSync(next, o.binary);
	} catch (e) {
		return fail(e instanceof Error ? e.message : 'The update failed');
	}
	const done: UpdateStatus = { state: 'done', version, at: Date.now() };
	writeStatus(o.statusFile, done);
	await o.restart();
	return done;
}

/** `minecrafty self-update`: the root service's entry point. */
export async function runSelfUpdate(current: string) {
	const status = await applyUpdate({
		requestFile: updateRequestFile(),
		statusFile: updateStatusFile(),
		binary: process.execPath,
		repo: process.env.MINECRAFTY_REPO ?? 'chrlstnmru/minecrafty',
		current,
		asset: releaseAsset(),
		restart: async () => {
			// the panel's unit uses KillMode=process, so the game servers keep running
			await Bun.spawn(['systemctl', 'restart', 'minecrafty']).exited;
		}
	});
	if (status)
		console.log(`[self-update] ${status.state} ${status.version} ${status.message ?? ''}`);
}
