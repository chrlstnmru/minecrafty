import { desc, eq, lt } from 'drizzle-orm';

import { db } from './db';
import { auditLog, instances } from './db/schema';

/** How long entries are kept. */
export const AUDIT_DAYS = 180;
/** The most rows one listing returns. */
export const AUDIT_LIMIT = 1000;

export type AuditInput = {
	/** a dotted name such as "instance.start" */
	action: string;
	/** one line a person can read: "Started the server" */
	summary: string;
	instanceId?: number | null;
};

export type Actor = { id: number | null; name: string };

type ActorProvider = () => Actor | null;
let provider: ActorProvider | null = null;

/**
 * Says how to find who is making the current request. The hooks set it, which keeps this module
 * free of `$app/server`, so the code that writes entries can be tested.
 */
export function setActorProvider(next: ActorProvider) {
	provider = next;
}

/**
 * Whoever made the request, or the panel itself when there is none (a schedule, a start at boot).
 * Work that outlives its request takes this while the request is still there.
 */
export function currentActor(): Actor {
	try {
		const actor = provider?.();
		if (actor) return actor;
	} catch {
		// not inside a request
	}
	return { id: null, name: 'Panel' };
}

/**
 * Writes one entry. It never throws: a failed audit write must not undo or block what the person
 * just did, so it is logged and dropped.
 */
export function record(input: AuditInput, actor: Actor = currentActor()) {
	try {
		const instanceName =
			input.instanceId != null
				? (db
						.select({ name: instances.name })
						.from(instances)
						.where(eq(instances.id, input.instanceId))
						.get()?.name ?? null)
				: null;
		db.insert(auditLog)
			.values({
				actorId: actor.id,
				actorName: actor.name,
				action: input.action,
				instanceId: input.instanceId ?? null,
				instanceName,
				summary: input.summary.slice(0, 500)
			})
			.run();
	} catch (e) {
		console.error('[audit] could not record', input.action, e);
	}
}

/** The newest entries, for one instance or all of them. */
export function listAudit(options: { instanceId?: number; limit?: number } = {}) {
	const limit = Math.min(options.limit ?? AUDIT_LIMIT, AUDIT_LIMIT);
	return db
		.select()
		.from(auditLog)
		.where(options.instanceId != null ? eq(auditLog.instanceId, options.instanceId) : undefined)
		.orderBy(desc(auditLog.at), desc(auditLog.id))
		.limit(limit)
		.all();
}

/** Drops entries older than the retention. Returns how many went. */
export function pruneAudit(now = new Date(), days = AUDIT_DAYS) {
	const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
	return db.delete(auditLog).where(lt(auditLog.at, cutoff)).returning({ id: auditLog.id }).all()
		.length;
}
