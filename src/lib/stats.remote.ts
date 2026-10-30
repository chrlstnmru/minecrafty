import { query } from '$app/server';
import { requireAdmin } from '#lib/server/auth.js';
import { getSnapshot } from '#lib/server/stats.js';

/** The host's and each server's numbers, as they are now and every few seconds after. */
export const liveStats = query.live(async function* () {
	requireAdmin();
	for (;;) {
		yield await getSnapshot();
		await Bun.sleep(3000);
	}
});
