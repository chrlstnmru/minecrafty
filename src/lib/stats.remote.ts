import { query } from '$app/server';
import { visibleInstanceIds } from '#lib/server/access.js';
import { requireUser } from '#lib/server/auth.js';
import { overview } from '#lib/server/overview.js';
import { getSnapshot, type Snapshot } from '#lib/server/stats.js';

/** Only an admin sees the host and the disk; anyone else gets just the servers they may view. */
function limit(snapshot: Snapshot, visible: number[] | null): Snapshot {
	if (!visible) return snapshot;
	return {
		at: snapshot.at,
		host: { cpu: null, cores: 0, memTotal: 0, memUsed: 0, uptime: 0 },
		history: { cpu: [], mem: [] },
		storage: { total: 0, free: 0, instances: 0, backups: 0 },
		instances: Object.fromEntries(
			Object.entries(snapshot.instances).filter(([id]) => visible.includes(Number(id)))
		)
	};
}

/** The host's and each server's numbers, as they are now and every few seconds after. */
export const liveStats = query.live(async function* () {
	const user = requireUser();
	for (;;) {
		yield limit(await getSnapshot(), visibleInstanceIds(user));
		await Bun.sleep(3000);
	}
});

/** The last backup and the next scheduled task across the servers the user may see. */
export const overviewNow = query(async () => {
	const user = requireUser();
	return overview(new Date(), visibleInstanceIds(user));
});
