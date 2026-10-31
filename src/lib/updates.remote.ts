import { command, query } from '$app/server';
import * as v from 'valibot';
import { requireOwner } from '#lib/server/auth.js';
import { record } from '#lib/server/audit.js';
import { userFacing } from '#lib/server/http.js';
import * as updates from '#lib/server/self-update.js';

/** The running version, the last check and any update in progress. */
export const updateInfo = query(() => {
	requireOwner();
	return updates.updateState();
});

export const checkForUpdates = command(async () => {
	requireOwner();
	await updates.checkForUpdate();
	await updateInfo().refresh();
});

/** Full releases only, or pre-releases too; checks the new channel straight away. */
export const setUpdateChannel = command(v.picklist(['release', 'prerelease']), async (channel) => {
	requireOwner();
	await updates.setUpdateChannel(channel);
	record({
		action: 'panel.update-channel',
		summary:
			channel === 'prerelease'
				? 'Switched app updates to pre-releases'
				: 'Switched app updates to full releases only'
	});
	await updateInfo().refresh();
});

/** Asks the root update service to install the release on offer; the panel restarts once it is in. */
export const installUpdate = command(
	v.object({ version: v.pipe(v.string(), v.maxLength(40)) }),
	async ({ version }) => {
		requireOwner();
		await userFacing(async () => updates.requestUpdate(version));
		record({
			action: 'panel.update',
			summary: `Started the update from ${updates.currentVersion} to ${version}`
		});
		await updateInfo().refresh();
	}
);
