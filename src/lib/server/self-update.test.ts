import { beforeEach, describe, expect, it } from 'vitest';
import type { Fetch } from './self-update-apply';
import * as U from './self-update';
import { deleteSetting } from './settings';

const release =
	(tag: string): Fetch =>
	async () =>
		Response.json({
			tag_name: tag,
			html_url: `https://github.com/x/y/releases/tag/${tag}`,
			published_at: '2026-10-01T00:00:00Z',
			body: 'Notes'
		});

/** GitHub's list of recent releases, newest first as it sends them. */
const releases =
	(...tags: (string | { tag: string; draft: boolean })[]): Fetch =>
	async (url) => {
		if (String(url).endsWith('/releases/latest')) return release('v0.1.0')(url);
		return Response.json(
			tags.map((t) => {
				const tag = typeof t === 'string' ? t : t.tag;
				return {
					tag_name: tag,
					html_url: `https://github.com/x/y/releases/tag/${tag}`,
					published_at: null,
					body: `Notes for ${tag}`,
					draft: typeof t === 'string' ? false : t.draft
				};
			})
		);
	};

beforeEach(() => {
	U.resetUpdateCheck();
	deleteSetting('update.channel');
});

describe('update check', () => {
	it('offers a newer release, and nothing to a development build or a newer install', async () => {
		await U.checkForUpdate(release('v0.2.0'));
		expect(U.availableUpdate('v0.1.0')).toMatchObject({ version: 'v0.2.0', notes: 'Notes' });
		expect(U.availableUpdate('v0.2.0-rc.1')?.version).toBe('v0.2.0');
		expect(U.availableUpdate('v0.2.0')).toBeNull();
		expect(U.availableUpdate('dev')).toBeNull();
	});

	it('keeps what it knew when GitHub cannot be reached, and says why', async () => {
		await U.checkForUpdate(release('v0.2.0'));
		const state = await U.checkForUpdate(async () => new Response('', { status: 503 }));
		expect(state).toMatchObject({ error: 'GitHub responded 503', latest: { version: 'v0.2.0' } });
	});

	it('treats a repository with no release yet as up to date', async () => {
		const state = await U.checkForUpdate(async () => new Response('', { status: 404 }));
		expect(state).toMatchObject({ latest: null, error: null });
	});

	it('refuses a request on an install that cannot update itself', () => {
		expect(U.canInstallUpdates()).toBe(false);
		expect(() => U.requestUpdate('v0.2.0')).toThrow(/cannot update itself/);
	});

	it('offers full releases only until the owner chooses pre-releases', async () => {
		expect(U.updateChannel()).toBe('release');
		await U.checkForUpdate(releases('v0.2.0-rc.1'));
		expect(U.availableUpdate('v0.1.0-rc.3')).toMatchObject({
			version: 'v0.1.0',
			prerelease: false
		});
	});

	it('on the pre-release channel, offers the newest release of either kind', async () => {
		await U.setUpdateChannel('prerelease', releases('v0.2.0-rc.10', 'v0.2.0-rc.9', 'v0.1.0'));
		expect(U.updateChannel()).toBe('prerelease');
		expect(U.availableUpdate('v0.1.0-rc.3')).toMatchObject({
			version: 'v0.2.0-rc.10',
			prerelease: true,
			notes: 'Notes for v0.2.0-rc.10'
		});
		await U.checkForUpdate(releases('v0.2.0', 'v0.2.0-rc.10'));
		expect(U.availableUpdate('v0.2.0-rc.10')).toMatchObject({
			version: 'v0.2.0',
			prerelease: false
		});
	});

	it('skips drafts and tags that are not releases', async () => {
		await U.setUpdateChannel(
			'prerelease',
			releases({ tag: 'v9.0.0', draft: true }, 'nightly', 'v0.2.0-rc.1')
		);
		expect(U.availableUpdate('v0.1.0')?.version).toBe('v0.2.0-rc.1');
	});

	it('does not offer what the other channel found, and never an older version', async () => {
		await U.setUpdateChannel('prerelease', releases('v0.2.0-rc.1'));
		await U.setUpdateChannel('release', async () => new Response('', { status: 503 }));
		expect(U.availableUpdate('v0.1.0')).toBeNull();
		await U.checkForUpdate(releases());
		// back on full releases while running a newer pre-release: nothing until a newer release
		expect(U.availableUpdate('v0.2.0-rc.1')).toBeNull();
	});
});
