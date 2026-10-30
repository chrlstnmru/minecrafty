import { desc, eq } from 'drizzle-orm';
import { nextRun, parseCron } from '#lib/cron.js';
import { db } from './db';
import { backups, instances, schedules } from './db/schema';

export type Overview = {
	lastBackup: { at: number; instanceName: string } | null;
	/** servers that have never been backed up */
	withoutBackup: number;
	nextTask: { at: number; name: string; instanceId: number; instanceName: string } | null;
};

/** What the dashboard says about backups and scheduled tasks across every server. */
export function overview(now = new Date(), visible: number[] | null = null): Overview {
	const names = new Map(
		db
			.select({ id: instances.id, name: instances.name })
			.from(instances)
			.all()
			.filter((r) => !visible || visible.includes(r.id))
			.map((r) => [r.id, r.name])
	);

	const latest = db
		.select()
		.from(backups)
		.orderBy(desc(backups.createdAt), desc(backups.id))
		.all()
		.find((b) => names.has(b.instanceId));
	const backedUp = new Set(
		db
			.select({ id: backups.instanceId })
			.from(backups)
			.all()
			.map((r) => r.id)
	);

	let nextTask: Overview['nextTask'] = null;
	for (const task of db.select().from(schedules).where(eq(schedules.enabled, true)).all()) {
		if (!names.has(task.instanceId)) continue;
		const parsed = parseCron(task.cron);
		if (!parsed.ok) continue;
		const at = nextRun(parsed.spec, now);
		if (at && (!nextTask || at.getTime() < nextTask.at))
			nextTask = {
				at: at.getTime(),
				name: task.name,
				instanceId: task.instanceId,
				instanceName: names.get(task.instanceId) ?? ''
			};
	}

	return {
		lastBackup: latest
			? { at: latest.createdAt.getTime(), instanceName: names.get(latest.instanceId) ?? '' }
			: null,
		withoutBackup: [...names.keys()].filter((id) => !backedUp.has(id)).length,
		nextTask
	};
}
