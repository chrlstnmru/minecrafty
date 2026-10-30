import { and, eq, isNull } from 'drizzle-orm';
import {
	PERMISSIONS,
	INSTANCE_PERMISSIONS,
	PANEL_PERMISSIONS,
	grantedBy,
	isInstancePermission,
	parseRules,
	type InstancePermission,
	type PanelPermission,
	type Permission
} from '#lib/permissions.js';
import { db } from './db';
import { instances, roleAssignments, roles } from './db/schema';

export type Actor = { id: number; role: 'admin' | 'user' };

/** One role given to a user, with what it grants and denies already worked out. */
export type Entry = {
	roleId: number;
	rank: number;
	/** null: assigned on the whole panel */
	instanceId: number | null;
	granted: Set<Permission>;
};

/** A user's role assignments, read fresh each time so a change applies on the very next request. */
export function entriesFor(userId: number): Entry[] {
	return db
		.select({
			roleId: roles.id,
			rank: roles.rank,
			rules: roles.rules,
			instanceId: roleAssignments.instanceId
		})
		.from(roleAssignments)
		.innerJoin(roles, eq(roles.id, roleAssignments.roleId))
		.where(and(eq(roleAssignments.userId, userId), isNull(roles.deletedAt)))
		.all()
		.map((row) => {
			const rules = parseRules(row.rules);
			return {
				roleId: row.roleId,
				rank: row.rank,
				instanceId: row.instanceId,
				granted: new Set(grantedBy(rules))
			};
		});
}

/**
 * What the entries amount to on an instance (or on the panel itself, with null). A permission is
 * granted by any applicable role. Panel permissions only come from roles assigned panel-wide;
 * instance permissions come from those and from roles assigned to this instance.
 */
export function resolve(entries: readonly Entry[], instanceId: number | null): Set<Permission> {
	const granted = new Set<Permission>();
	for (const entry of entries) {
		const panelWide = entry.instanceId === null;
		const here = panelWide || (instanceId !== null && entry.instanceId === instanceId);
		for (const key of entry.granted) {
			if (isInstancePermission(key) ? here : panelWide) granted.add(key);
		}
	}
	return granted;
}

const allKeys = () => new Set<Permission>(PERMISSIONS);

function grantedTo(user: Actor, instanceId: number | null) {
	return user.role === 'admin' ? allKeys() : resolve(entriesFor(user.id), instanceId);
}

/** What this user may do on this instance: everything for an admin, what their roles grant otherwise. */
export function permissionsFor(user: Actor, instanceId: number): InstancePermission[] {
	const granted = grantedTo(user, instanceId);
	return INSTANCE_PERMISSIONS.filter((p) => granted.has(p));
}

/** What this user may do on the panel as a whole. */
export function panelPermissionsFor(user: Actor): PanelPermission[] {
	const granted = grantedTo(user, null);
	return PANEL_PERMISSIONS.filter((p) => granted.has(p));
}

/** Whether the user holds a permission, on the given instance for per-server ones. */
export function can(user: Actor, key: Permission, options?: { instanceId?: number }): boolean {
	if (user.role === 'admin') return true;
	const instanceId = isInstancePermission(key) ? (options?.instanceId ?? null) : null;
	if (isInstancePermission(key) && instanceId === null) return false;
	return grantedTo(user, instanceId).has(key);
}

/** The instances the user may see, or null for all of them (an admin). */
export function visibleInstanceIds(user: Actor): number[] | null {
	if (user.role === 'admin') return null;
	const entries = entriesFor(user.id);
	if (!entries.length) return [];
	return db
		.select({ id: instances.id })
		.from(instances)
		.all()
		.map((row) => row.id)
		.filter((id) => seesAny(resolve(entries, id)));
}

/** Seeing a server means holding any permission on it. */
const seesAny = (granted: ReadonlySet<Permission>) =>
	INSTANCE_PERMISSIONS.some((p) => granted.has(p));

/** Whether the user may see the instance at all. */
export const canSee = (user: Actor, instanceId: number) => seesAny(grantedTo(user, instanceId));

export type Check = 'ok' | 'unknown' | 'denied';

/**
 * Whether the user may do `needed` on the instance. "unknown" means they may not even see it, which
 * callers report as not found, so a server they have no access to does not reveal that it exists.
 */
export function check(user: Actor, instanceId: number, needed: InstancePermission): Check {
	const granted = grantedTo(user, instanceId);
	if (!seesAny(granted)) return 'unknown';
	return granted.has(needed) ? 'ok' : 'denied';
}

/** The user's own rank: an admin outranks every role, someone with no role has none. */
export function rankOf(user: Actor): number {
	if (user.role === 'admin') return Infinity;
	return entriesFor(user.id).reduce((max, e) => Math.max(max, e.rank), -Infinity);
}

/** The highest rank among the user's roles that grant `key` where it applies (admin: unlimited). */
export function grantingRank(user: Actor, key: Permission, instanceId: number | null): number {
	if (user.role === 'admin') return Infinity;
	return entriesFor(user.id)
		.filter(
			(e) =>
				e.granted.has(key) &&
				(e.instanceId === null || (instanceId !== null && e.instanceId === instanceId))
		)
		.reduce((max, e) => Math.max(max, e.rank), -Infinity);
}

/** Whether the user holds the role through any assignment. */
export function holdsRole(userId: number, roleId: number): boolean {
	return !!db
		.select({ id: roleAssignments.id })
		.from(roleAssignments)
		.where(and(eq(roleAssignments.userId, userId), eq(roleAssignments.roleId, roleId)))
		.get();
}

/** A user's role assignments, for the page that edits them: instanceId null is panel-wide. */
export function listAssignments(userId: number) {
	return db
		.select({ roleId: roleAssignments.roleId, instanceId: roleAssignments.instanceId })
		.from(roleAssignments)
		.innerJoin(roles, eq(roles.id, roleAssignments.roleId))
		.where(and(eq(roleAssignments.userId, userId), isNull(roles.deletedAt)))
		.all();
}

/** Replaces the roles a user has on an instance (null: panel-wide) with exactly these. */
export function setAssignments(userId: number, instanceId: number | null, roleIds: number[]) {
	const unique = [...new Set(roleIds)];
	for (const roleId of unique) {
		if (
			!db
				.select()
				.from(roles)
				.where(and(eq(roles.id, roleId), isNull(roles.deletedAt)))
				.get()
		)
			throw new Error('Role not found');
	}
	db.transaction((tx) => {
		tx.delete(roleAssignments)
			.where(
				and(
					eq(roleAssignments.userId, userId),
					instanceId === null
						? isNull(roleAssignments.instanceId)
						: eq(roleAssignments.instanceId, instanceId)
				)
			)
			.run();
		for (const roleId of unique)
			tx.insert(roleAssignments).values({ userId, roleId, instanceId }).run();
	});
}
