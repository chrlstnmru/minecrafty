import { and, eq } from 'drizzle-orm';
import { PERMISSIONS, grantedBy, parseRules, type Permission } from '#lib/permissions.js';
import { db } from './db';
import { instancePermissions, roles } from './db/schema';

export type Actor = { id: number; role: 'admin' | 'user' };

function ruleFor(userId: number, instanceId: number) {
	const row = db
		.select({ rules: roles.rules })
		.from(instancePermissions)
		.innerJoin(roles, eq(roles.id, instancePermissions.roleId))
		.where(
			and(eq(instancePermissions.userId, userId), eq(instancePermissions.instanceId, instanceId))
		)
		.get();
	return row ? parseRules(row.rules) : null;
}

/** What this user may do on this instance: everything for an admin, what their role grants for anyone else. */
export function permissionsFor(user: Actor, instanceId: number): Permission[] {
	if (user.role === 'admin') return [...PERMISSIONS];
	const rules = ruleFor(user.id, instanceId);
	return rules ? grantedBy(rules) : [];
}

/** The instances the user may see, or null for all of them (an admin). */
export function visibleInstanceIds(user: Actor): number[] | null {
	if (user.role === 'admin') return null;
	return db
		.select({ id: instancePermissions.instanceId, rules: roles.rules })
		.from(instancePermissions)
		.innerJoin(roles, eq(roles.id, instancePermissions.roleId))
		.where(eq(instancePermissions.userId, user.id))
		.all()
		.filter((row) => grantedBy(parseRules(row.rules)).length > 0)
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

/** The role a user has on every instance, for the page that edits it. */
export function listAccess(userId: number) {
	return db
		.select({ instanceId: instancePermissions.instanceId, roleId: instancePermissions.roleId })
		.from(instancePermissions)
		.where(eq(instancePermissions.userId, userId))
		.all();
}

/** Gives a user a role on an instance, or takes their access away with null. */
export function setAccess(userId: number, instanceId: number, roleId: number | null) {
	if (roleId === null) {
		db.delete(instancePermissions)
			.where(
				and(eq(instancePermissions.userId, userId), eq(instancePermissions.instanceId, instanceId))
			)
			.run();
		return;
	}
	if (!db.select().from(roles).where(eq(roles.id, roleId)).get()) throw new Error('Role not found');
	db.insert(instancePermissions)
		.values({ userId, instanceId, roleId })
		.onConflictDoUpdate({
			target: [instancePermissions.userId, instancePermissions.instanceId],
			set: { roleId }
		})
		.run();
}
