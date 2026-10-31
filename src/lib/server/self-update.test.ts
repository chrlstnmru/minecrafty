import { beforeEach, describe, expect, it } from 'vitest';
import type { Fetch } from './self-update-apply';
import * as U from './self-update';

const release =
	(tag: string): Fetch =>
	async () =>
		Response.json({
			tag_name: tag,
			html_url: `https://github.com/x/y/releases/tag/${tag}`,
			published_at: '2026-10-01T00:00:00Z',
			body: 'Notes'
		});

beforeEach(() => U.resetUpdateCheck());

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
});
