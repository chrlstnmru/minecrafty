import { and, eq } from 'drizzle-orm';
import { PERMISSIONS, normalizePermissions, type Permission } from '#lib/permissions.js';
import { db } from './db';
import { instancePermissions } from './db/schema';

export type Actor = { id: number; role: 'admin' | 'user' };

function stored(userId: number, instanceId: number): Permission[] {
	const row = db
		.select()
		.from(instancePermissions)
		.where(
			and(eq(instancePermissions.userId, userId), eq(instancePermissions.instanceId, instanceId))
		)
		.get();
	if (!row) return [];
	try {
		const list = JSON.parse(row.permissions) as unknown;
		return Array.isArray(list) ? normalizePermissions(list.map(String)) : [];
	} catch {
		// a damaged row grants nothing
		return [];
	}
}

/** What this user may do on this instance: everything for an admin, what was granted for anyone else. */
export function permissionsFor(user: Actor, instanceId: number): Permission[] {
	return user.role === 'admin' ? [...PERMISSIONS] : stored(user.id, instanceId);
}

/** The instances the user may see, or null for all of them (an admin). */
export function visibleInstanceIds(user: Actor): number[] | null {
	if (user.role === 'admin') return null;
	return db
		.select({ id: instancePermissions.instanceId, permissions: instancePermissions.permissions })
		.from(instancePermissions)
		.where(eq(instancePermissions.userId, user.id))
		.all()
		.filter((row) => stored(user.id, row.id).length > 0)
		.map((row) => row.id);
}

export type Check = 'ok' | 'unknown' | 'denied';

/**
 * Whether the user may do `needed` on the instance. "unknown" means they may not even see it, which
 * callers report as not found, so a server they have no access to does not reveal that it exists.
 */
export function check(user: Actor, instanceId: number, needed: Permission): Check {
	const granted = permissionsFor(user, instanceId);
	if (!granted.includes('view')) return 'unknown';
	return granted.includes(needed) ? 'ok' : 'denied';
}

/** What a user has been granted on every instance, for the page that edits it. */
export function listAccess(userId: number) {
	return db
		.select()
		.from(instancePermissions)
		.where(eq(instancePermissions.userId, userId))
		.all()
		.map((row) => ({ instanceId: row.instanceId, permissions: stored(userId, row.instanceId) }))
		.filter((row) => row.permissions.length > 0);
}

/** Replaces what a user may do on an instance. An empty list removes the access. */
export function setAccess(userId: number, instanceId: number, permissions: readonly string[]) {
	const clean = normalizePermissions(permissions);
	if (!clean.length) {
		db.delete(instancePermissions)
			.where(
				and(eq(instancePermissions.userId, userId), eq(instancePermissions.instanceId, instanceId))
			)
			.run();
		return [];
	}
	db.insert(instancePermissions)
		.values({ userId, instanceId, permissions: JSON.stringify(clean) })
		.onConflictDoUpdate({
			target: [instancePermissions.userId, instancePermissions.instanceId],
			set: { permissions: JSON.stringify(clean) }
		})
		.run();
	return clean;
}
