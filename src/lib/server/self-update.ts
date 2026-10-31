// The panel's side of updating Minecrafty: it checks GitHub once a day for a newer release on the
// owner's channel (full releases only, unless they chose pre-releases) and, when the owner asks,
// leaves a request for the root update service (see self-update-apply.ts). Nothing is installed
// unasked.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { compareReleases, isReleaseTag, isStableTag } from '../release-version';
import { compiled } from './config';
import { getSetting, setSetting } from './settings';
import {
	updateRequestFile,
	updateStatusFile,
	type Fetch,
	type UpdateStatus
} from './self-update-apply';

/** The release this build came from; `dev` for anything not built by the release workflow. */
export const currentVersion =
	typeof __MINECRAFTY_VERSION__ === 'string' && __MINECRAFTY_VERSION__
		? __MINECRAFTY_VERSION__
		: 'dev';

const repo = () => process.env.MINECRAFTY_REPO ?? 'chrlstnmru/minecrafty';

export type Release = {
	version: string;
	url: string;
	publishedAt: string | null;
	notes: string;
	prerelease: boolean;
};

export type UpdateChannel = 'release' | 'prerelease';

const CHANNEL_KEY = 'update.channel';

/** Which releases are offered: full releases (the default), or pre-releases too. */
export const updateChannel = (): UpdateChannel =>
	getSetting(CHANNEL_KEY) === 'prerelease' ? 'prerelease' : 'release';

let last: {
	checkedAt: number;
	channel: UpdateChannel;
	latest: Release | null;
	error: string | null;
} | null = null;

type GithubRelease = {
	tag_name: string;
	html_url: string;
	published_at: string | null;
	body: string | null;
	draft?: boolean;
};

const toRelease = (body: GithubRelease): Release => ({
	version: body.tag_name,
	url: body.html_url,
	publishedAt: body.published_at,
	notes: (body.body ?? '').slice(0, 4000),
	prerelease: !isStableTag(body.tag_name)
});

/** The newest release on the channel, or null when there is none yet. */
async function newestRelease(get: Fetch, channel: UpdateChannel): Promise<Release | null> {
	const headers = { accept: 'application/vnd.github+json', 'user-agent': 'minecrafty' };
	const signal = AbortSignal.timeout(15_000);
	// releases/latest skips pre-releases, so the pre-release channel looks through the recent ones
	const url =
		channel === 'release'
			? `https://api.github.com/repos/${repo()}/releases/latest`
			: `https://api.github.com/repos/${repo()}/releases?per_page=30`;
	const res = await get(url, { headers, signal });
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
	if (channel === 'release') {
		const body = (await res.json()) as GithubRelease;
		if (!isStableTag(body.tag_name)) throw new Error(`Unexpected release tag ${body.tag_name}`);
		return toRelease(body);
	}
	const list = ((await res.json()) as GithubRelease[]).filter(
		(r) => !r.draft && isReleaseTag(r.tag_name)
	);
	const newest = list.reduce<GithubRelease | null>(
		(best, r) => (!best || (compareReleases(r.tag_name, best.tag_name) ?? 0) > 0 ? r : best),
		null
	);
	return newest && toRelease(newest);
}

/** Asks GitHub for the newest release on the owner's channel and remembers the answer. */
export async function checkForUpdate(get: Fetch = fetch) {
	const channel = updateChannel();
	try {
		last = {
			checkedAt: Date.now(),
			channel,
			latest: await newestRelease(get, channel),
			error: null
		};
	} catch (e) {
		last = {
			checkedAt: Date.now(),
			channel,
			// what the other channel found is not on offer on this one
			latest: last?.channel === channel ? last.latest : null,
			error: e instanceof Error ? e.message : 'Could not reach GitHub'
		};
	}
	return last;
}

/** Switches the channel and checks it straight away, so Settings shows what it offers. */
export async function setUpdateChannel(channel: UpdateChannel, get: Fetch = fetch) {
	setSetting(CHANNEL_KEY, channel);
	return checkForUpdate(get);
}

/** The newer release, if the last check found one. */
export function availableUpdate(current = currentVersion) {
	const latest = last?.channel === updateChannel() ? last.latest : null;
	if (!latest || current === 'dev') return null;
	return (compareReleases(latest.version, current) ?? 0) > 0 ? latest : null;
}

/** Only the Linux service install has the root update service; anything else shows the command. */
export const canInstallUpdates = () =>
	compiled &&
	currentVersion !== 'dev' &&
	process.platform === 'linux' &&
	process.env.MINECRAFTY_UPDATER === 'systemd';

function readStatus(): UpdateStatus | null {
	try {
		return JSON.parse(readFileSync(updateStatusFile(), 'utf8')) as UpdateStatus;
	} catch {
		return null;
	}
}

/** What the Settings page shows. */
export function updateState() {
	return {
		current: currentVersion,
		repo: repo(),
		channel: updateChannel(),
		checkedAt: last?.checkedAt ?? null,
		error: last?.error ?? null,
		latest: last?.latest ?? null,
		available: availableUpdate(),
		canInstall: canInstallUpdates(),
		requested: existsSync(updateRequestFile()),
		status: compiled ? readStatus() : null
	};
}

/** Leaves the request the root update service picks up; only the release found by the last check. */
export function requestUpdate(version: string) {
	if (!canInstallUpdates())
		throw new Error('This install cannot update itself; run the command instead');
	const available = availableUpdate();
	if (!available || available.version !== version)
		throw new Error(`${version} is not the update on offer; check again`);
	writeFileSync(
		updateRequestFile(),
		JSON.stringify({ version, channel: available.prerelease ? 'prerelease' : 'release' })
	);
}

/** Checks a minute after start, then once a day. */
export function startUpdateChecks() {
	setTimeout(() => void checkForUpdate(), 60_000).unref();
	setInterval(() => void checkForUpdate(), 24 * 60 * 60 * 1000).unref();
}

/** For tests: forget the last check. */
export function resetUpdateCheck() {
	last = null;
}
