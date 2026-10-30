import { query } from '$app/server';
import { requireAdmin } from '#lib/server/auth.js';
import { overview } from '#lib/server/overview.js';
import { getSnapshot } from '#lib/server/stats.js';

/** The host's and each server's numbers, as they are now and every few seconds after. */
export const liveStats = query.live(async function* () {
	requireAdmin();
	for (;;) {
		yield await getSnapshot();
		await Bun.sleep(3000);
	}
});

/** The last backup and the next scheduled task, across every server. */
export const overviewNow = query(async () => {
	requireAdmin();
	return overview();
});
