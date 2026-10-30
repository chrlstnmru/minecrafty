import { eq } from 'drizzle-orm';
import { MAX_RANK, closure, registry, type Permission } from '#lib/permissions.js';
import { LOCK_MESSAGES, type RoleLock } from '#lib/role-lock.js';
import { can, entriesFor, grantingRank, holdsRole, rankOf, resolve, type Actor } from './access';
import { db } from './db';
import { roles, users } from './db/schema';

export interface GrantCheck {
	ok: boolean;
	reason?: string;
}

const deny = (reason: string): GrantCheck => ({ ok: false, reason });
const allow: GrantCheck = { ok: true };

const isAdmin = (actor: Actor) => actor.role === 'admin';

function activeRole(roleId: number) {
	const row = db.select().from(roles).where(eq(roles.id, roleId)).get();
	return row && !row.deletedAt ? row : undefined;
}

export function roleLock(
	actor: Actor,
	role: { id: number; rank: number; builtIn: boolean; permissions: readonly Permission[] }
): RoleLock | null {
	if (!can(actor, 'roles.write')) return 'read-only';
	if (role.builtIn) return 'built-in';
	if (isAdmin(actor)) return null;
	if (!(role.rank < rankOf(actor))) return 'rank';
	if (holdsRole(actor.id, role.id)) return 'held';
	if (role.permissions.some((key) => registry[key].ownerOnlyGrant)) return 'owner-only';
	return null;
}

/**
 * Whether the actor may create or edit a role holding these permissions at `rank`: they must hold
 * `roles.write`, only an admin may add an admin-only permission, a non-admin may only hand out
 * what they hold panel-wide themselves (an addition to sv-erp's rules), and the rank must be below
 * their own.
 */
export function canGrantRolePermissions(
	actor: Actor,
	permissions: readonly Permission[],
	rank: number
): GrantCheck {
	if (!Number.isInteger(rank) || rank < 0 || rank > MAX_RANK)
		return deny(`Rank is a whole number from 0 to ${MAX_RANK}`);
	if (!can(actor, 'roles.write')) return deny('You cannot manage roles');
	if (isAdmin(actor)) return allow;

	const wanted = closure(permissions);
	const ownerOnly = [...wanted].find((key) => registry[key].ownerOnlyGrant);
	if (ownerOnly) return deny(`Only an admin may grant "${registry[ownerOnly].label}"`);

	const held = resolve(entriesFor(actor.id), null);
	const missing = [...wanted].find((key) => !held.has(key));
	if (missing) return deny(`You do not hold "${registry[missing].label}" yourself`);

	if (!(rank < rankOf(actor))) return deny('A role must rank below your own');
	return allow;
}

/** The same, for a role that exists: it must not be locked for the actor. */
export function canEditRole(
	actor: Actor,
	roleId: number,
	permissions: readonly Permission[],
	rank: number
): GrantCheck {
	const role = activeRole(roleId);
	if (!role) return deny('Role not found');
	const current = {
		id: role.id,
		rank: role.rank,
		builtIn: role.builtIn,
		permissions: [] as Permission[]
	};
	// the stored permissions matter for the admin-only check, so read them back
	const stored = JSON.parse(role.rules) as { allow?: Permission[] };
	current.permissions = stored.allow ?? [];
	const lock = roleLock(actor, current);
	if (lock) return deny(LOCK_MESSAGES[lock]);
	return canGrantRolePermissions(actor, permissions, rank);
}

export function canDeleteRole(actor: Actor, roleId: number): GrantCheck {
	const role = activeRole(roleId);
	if (!role) return deny('Role not found');
	const stored = JSON.parse(role.rules) as { allow?: Permission[] };
	const lock = roleLock(actor, {
		id: role.id,
		rank: role.rank,
		builtIn: role.builtIn,
		permissions: stored.allow ?? []
	});
	return lock ? deny(LOCK_MESSAGES[lock]) : allow;
}

/**
 * Whether the actor may use a `hierarchical` permission on a person: they must hold it (on the
 * instance, if given), the person must not be themselves or an admin, and the actor's rank for
 * that permission must be above the person's highest rank.
 */
export function canActOnRecord(
	actor: Actor,
	key: Permission,
	subject: { userId: number; instanceId?: number | null }
): GrantCheck {
	if (!can(actor, key, { instanceId: subject.instanceId ?? undefined }))
		return deny('You are not allowed to do that');
	if (subject.userId === actor.id) return deny('You cannot do that to yourself');
	const person = db.select().from(users).where(eq(users.id, subject.userId)).get();
	if (!person) return deny('User not found');
	if (person.role === 'admin' && !isAdmin(actor)) return deny('Only an admin can act on an admin');
	if (isAdmin(actor)) return allow;

	const subjectRank = rankOf({ id: person.id, role: person.role });
	return grantingRank(actor, key, subject.instanceId ?? null) > subjectRank
		? allow
		: deny('That person ranks as high as you or higher');
}

/** Whether the actor may give the person this role, on an instance or panel-wide (null). */
export function canAssignRole(
	actor: Actor,
	params: { subjectUserId: number; roleId: number; instanceId: number | null }
): GrantCheck {
	const role = activeRole(params.roleId);
	if (!role) return deny('Role not found');
	const onRecord = canActOnRecord(actor, 'roles.assign', {
		userId: params.subjectUserId,
		instanceId: null
	});
	if (!onRecord.ok) return onRecord;
	if (!isAdmin(actor) && !(role.rank < rankOf(actor)))
		return deny('You can only assign roles ranked below your own');
	return allow;
}

/** Whether the actor may add an account with this role. Making an admin is for admins. */
export function canAddUser(actor: Actor, role: 'admin' | 'user'): GrantCheck {
	if (!can(actor, 'users.write')) return deny('You are not allowed to add users');
	if (role === 'admin' && !isAdmin(actor)) return deny('Only an admin can make an admin');
	return allow;
}

/** Whether the actor may change an account's role between admin and user: admins only. */
export function canChangeAdminRole(actor: Actor): GrantCheck {
	return isAdmin(actor) ? allow : deny('Only an admin can change who is an admin');
}
