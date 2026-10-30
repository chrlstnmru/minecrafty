import { query } from '$app/server';
import { can, visibleInstanceIds } from '#lib/server/access.js';
import { requireUser } from '#lib/server/auth.js';
import { overview } from '#lib/server/overview.js';
import { getSnapshot, type Snapshot } from '#lib/server/stats.js';

/** The host and the disk need `host.view`; the servers listed are only the ones the caller may view. */
function limit(snapshot: Snapshot, visible: number[] | null, host: boolean): Snapshot {
	if (!visible && host) return snapshot;
	return {
		at: snapshot.at,
		host: host ? snapshot.host : { cpu: null, cores: 0, memTotal: 0, memUsed: 0, uptime: 0 },
		history: host ? snapshot.history : { cpu: [], mem: [] },
		storage: host ? snapshot.storage : { total: 0, free: 0, instances: 0, backups: 0 },
		instances: Object.fromEntries(
			Object.entries(snapshot.instances).filter(([id]) => !visible || visible.includes(Number(id)))
		)
	};
}

/** The host's and each server's numbers, as they are now and every few seconds after. */
export const liveStats = query.live(async function* () {
	const user = requireUser();
	for (;;) {
		yield limit(await getSnapshot(), visibleInstanceIds(user), can(user, 'host.view'));
		await Bun.sleep(3000);
	}
});

/** The last backup and the next scheduled task across the servers the user may see. */
export const overviewNow = query(async () => {
	const user = requireUser();
	return overview(new Date(), visibleInstanceIds(user));
});
