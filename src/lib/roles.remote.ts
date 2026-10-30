import { error, invalid } from '@sveltejs/kit';
import { command, form, query } from '$app/server';
import { idSchema } from '#lib/schemas/common.js';
import { newRoleSchema, saveRolesSchema } from '#lib/schemas/roles.js';
import { can, rankOf, type Actor } from '#lib/server/access.js';
import { requirePanel } from '#lib/server/auth.js';
import {
	canDeleteRole,
	canEditRole,
	canGrantRolePermissions,
	roleLock
} from '#lib/server/grants.js';
import { userFacing } from '#lib/server/http.js';
import * as roles from '#lib/server/roles.js';

/** Every role, highest first, with why the caller cannot change it (null when they can). */
function load(user: Actor) {
	const mine = rankOf(user);
	return roles.listRoles().map((role) => ({
		...role,
		lock: roleLock(user, role),
		/** whether the caller may hand this role to someone */
		assignable: user.role === 'admin' || role.rank < mine
	}));
}

export const listRoles = query(() => {
	const user = requirePanel('roles.read');
	return load(user);
});

/** What the caller may do on the roles page as a whole. */
export const getRoleAccess = query(() => {
	const user = requirePanel('roles.read');
	return { isAdmin: user.role === 'admin', canWrite: can(user, 'roles.write') };
});

/** "New role": a name only, placed at the bottom with no permissions. */
export const addRole = form(newRoleSchema, async ({ name }, issue) => {
	const user = requirePanel('roles.write');
	const current = load(user);
	if (current.some((r) => r.name.toLowerCase() === name.toLowerCase()))
		invalid(issue.name(`A role named "${name}" already exists. Pick another name.`));
	const locked = new Set(current.filter((r) => r.lock !== null).map((r) => r.id));
	const plan = roles.planBottom(current, locked);
	if (!plan) invalid('There is no room left below the other roles.');
	const check = canGrantRolePermissions(user, [], plan.get(0) ?? 0);
	if (!check.ok) error(403, check.reason ?? 'Not allowed');
	const created = await userFacing(async () => roles.createRole(name, locked));
	await listRoles().refresh();
	return { id: created.id };
});

/** Saves the roles page in one go: a new order and any number of edited roles, all or nothing. */
export const saveRoles = command(saveRolesSchema, async ({ order, roles: edits }) => {
	const user = requirePanel('roles.write');
	const current = load(user);
	const byId = new Map(current.map((r) => [r.id, r]));
	const locked = new Set(current.filter((r) => r.lock !== null).map((r) => r.id));
	const plan = await userFacing(async () => roles.planSave({ order, edits, locked }));

	// every role that changes, by edit or by being moved, must be one the caller may edit at its final rank
	const changed = new Set([...plan.ranks.keys(), ...edits.map((e) => e.roleId)]);
	for (const id of changed) {
		const existing = byId.get(id)!;
		const edit = edits.find((e) => e.roleId === id);
		const check = canEditRole(
			user,
			id,
			edit?.permissions ?? existing.permissions,
			plan.ranks.get(id) ?? existing.rank
		);
		if (!check.ok) error(403, `${existing.name}: ${check.reason}`);
	}
	roles.applySave(plan);
	await listRoles().refresh();
});

export const removeRole = command(idSchema, async (id) => {
	const user = requirePanel('roles.write');
	const check = canDeleteRole(user, id);
	if (!check.ok) error(403, check.reason ?? 'Not allowed');
	await userFacing(async () => roles.deleteRole(id));
	await listRoles().refresh();
});
