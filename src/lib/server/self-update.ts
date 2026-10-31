// The panel's side of updating Minecrafty: it checks GitHub once a day for a newer full release
// (pre-releases are skipped, as releases/latest skips them) and, when the owner asks, leaves a
// request for the root update service (see self-update-apply.ts). Nothing is installed unasked.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { compareReleases, isStableTag } from '../release-version';
import { compiled } from './config';
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

export type Release = { version: string; url: string; publishedAt: string | null; notes: string };

let last: { checkedAt: number; latest: Release | null; error: string | null } | null = null;

/** Asks GitHub for the latest full release and remembers the answer. */
export async function checkForUpdate(get: Fetch = fetch) {
	try {
		const res = await get(`https://api.github.com/repos/${repo()}/releases/latest`, {
			headers: { accept: 'application/vnd.github+json', 'user-agent': 'minecrafty' },
			signal: AbortSignal.timeout(15_000)
		});
		if (res.status === 404) {
			last = { checkedAt: Date.now(), latest: null, error: null };
			return last;
		}
		if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
		const body = (await res.json()) as {
			tag_name: string;
			html_url: string;
			published_at: string | null;
			body: string | null;
		};
		if (!isStableTag(body.tag_name)) throw new Error(`Unexpected release tag ${body.tag_name}`);
		last = {
			checkedAt: Date.now(),
			latest: {
				version: body.tag_name,
				url: body.html_url,
				publishedAt: body.published_at,
				notes: (body.body ?? '').slice(0, 4000)
			},
			error: null
		};
	} catch (e) {
		last = {
			checkedAt: Date.now(),
			latest: last?.latest ?? null,
			error: e instanceof Error ? e.message : 'Could not reach GitHub'
		};
	}
	return last;
}

/** The newer release, if the last check found one. */
export function availableUpdate(current = currentVersion) {
	const latest = last?.latest;
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
	writeFileSync(updateRequestFile(), JSON.stringify({ version }));
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
