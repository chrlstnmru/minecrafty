import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { writeBackup } from './backups';
import { db } from './db';
import { instances } from './db/schema';
import { clearProgress, setProgress } from './install-progress';
import { instanceDir, writeInstanceMeta } from './instances';
import { claim } from './operations';
import { clearOutcome, setOutcome } from './update-outcome';

/** What an update's steps can do while the job runs. */
export type UpdateTools = {
	/** an empty folder beside the server to build the new files in; removed when the job ends */
	staging: string;
	progress(label: string): void;
	/**
	 * Call right before the first change to the live server folder. A failure after it leaves the
	 * instance failed, because its files may be half replaced; before it, the server is untouched.
	 */
	commit(): void;
};

export type UpdateResult = {
	/** the instance columns the update changes */
	set: Partial<typeof instances.$inferInsert>;
	message: string;
	/** extra lines worth showing, such as the files an update left alone */
	details?: string[];
};

/**
 * Runs an update of an instance's server files in the background, and returns a promise that
 * settles when it is over, whichever way it went. The instance is claimed and marked installing
 * before this returns (and throws if something else holds it); on success it becomes ready with
 * `set` applied, on failure it becomes ready again or failed depending on whether the steps
 * reached the commit point, and the outcome is recorded either way.
 *
 * `backup` is the note for a backup taken first, or null for none.
 */
export function runUpdate(
	instanceId: number,
	opts: { kind: 'loader' | 'modpack'; backup: string | null },
	steps: (tools: UpdateTools) => Promise<UpdateResult>
) {
	const release = claim(instanceId, 'update');
	db.update(instances)
		.set({ installState: 'installing', installMessage: null })
		.where(eq(instances.id, instanceId))
		.run();
	clearOutcome(instanceId);
	setProgress(instanceId, { label: 'Starting', done: 0, total: 1 });

	return (async () => {
		const staging = join(instanceDir(instanceId), 'server.updating');
		let committed = false;
		const progress = (label: string) => setProgress(instanceId, { label, done: 0, total: 1 });
		try {
			if (opts.backup) {
				progress('Backing up the server');
				await writeBackup(instanceId, 'before-update', opts.backup);
			}
			rmSync(staging, { recursive: true, force: true });
			mkdirSync(staging, { recursive: true });

			const result = await steps({
				staging,
				progress,
				commit: () => {
					committed = true;
				}
			});

			const row = db
				.update(instances)
				.set({ ...result.set, installState: 'ready', installMessage: null })
				.where(eq(instances.id, instanceId))
				.returning()
				.get();
			writeInstanceMeta(row);
			setOutcome(instanceId, { ok: true, message: result.message, details: result.details });
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			console.error(`[${opts.kind}] update of #${instanceId} failed: ${message}`);
			db.update(instances)
				.set(
					committed
						? { installState: 'failed', installMessage: message.slice(0, 500) }
						: { installState: 'ready', installMessage: null }
				)
				.where(eq(instances.id, instanceId))
				.run();
			setOutcome(instanceId, {
				ok: false,
				message: committed ? `The update stopped part way: ${message}` : message
			});
		} finally {
			rmSync(staging, { recursive: true, force: true });
			clearProgress(instanceId);
			release();
		}
	})();
}
