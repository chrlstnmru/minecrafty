import { eq } from 'drizzle-orm';
import { db } from './db';
import { instances } from './db/schema';

// In-memory progress of background installs (modpack imports), keyed by instance id.
// Lost on restart on purpose: an install interrupted by a restart is marked failed at startup.

/** `bytes` says done and total are byte counts, which the page shows as sizes, not as a count of items. */
export type InstallProgress = { label: string; done: number; total: number; bytes?: boolean };

const progress = new Map<number, InstallProgress>();

export const setProgress = (id: number, value: InstallProgress) => progress.set(id, value);
export const clearProgress = (id: number) => progress.delete(id);
export const getProgress = (id: number) => progress.get(id) ?? null;

/**
 * Runs the work of a background install, then marks the instance ready, or failed with the
 * reason. The progress is cleared either way. `what` names the install in the log.
 */
export async function runInstall(
	row: { id: number; name: string },
	what: string,
	work: () => Promise<void>
) {
	try {
		await work();
		db.update(instances)
			.set({ installState: 'ready', installMessage: null })
			.where(eq(instances.id, row.id))
			.run();
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		console.error(`[install] ${what} of "${row.name}" (#${row.id}) failed: ${message}`);
		db.update(instances)
			.set({ installState: 'failed', installMessage: message.slice(0, 500) })
			.where(eq(instances.id, row.id))
			.run();
	} finally {
		clearProgress(row.id);
	}
}
