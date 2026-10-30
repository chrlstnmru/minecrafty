import { command, query } from '$app/server';
import { idSchema } from '#lib/schemas/common.js';
import { roleInputSchema, roleUpdateSchema } from '#lib/schemas/roles.js';
import { rankOf } from '#lib/server/access.js';
import { requirePanel } from '#lib/server/auth.js';
import { canDeleteRole, canEditRole, canGrantRolePermissions } from '#lib/server/grants.js';
import { userFacing } from '#lib/server/http.js';
import * as roles from '#lib/server/roles.js';
import { error } from '@sveltejs/kit';

/** Every role, with whether the caller may edit, delete or hand it out, judged by rank. */
export const allRoles = query(async () => {
	const user = requirePanel('users.read');
	const mine = rankOf(user);
	return roles.listRoles().map((role) => ({
		...role,
		canEdit: canEditRole(user, role.id, role.rules, role.rank).ok,
		canDelete: canDeleteRole(user, role.id).ok,
		assignable: user.role === 'admin' || role.rank < mine
	}));
});

const refuse = (check: { ok: boolean; reason?: string }) => {
	if (!check.ok) error(403, check.reason ?? 'Not allowed');
};

export const addRole = command(roleInputSchema, async (input) => {
	const user = requirePanel('roles.write');
	refuse(canGrantRolePermissions(user, input.rules, input.rank));
	const role = await userFacing(async () => roles.createRole(input));
	await allRoles().refresh();
	return role.id;
});

export const saveRole = command(roleUpdateSchema, async ({ id, ...input }) => {
	const user = requirePanel('roles.write');
	refuse(canEditRole(user, id, input.rules, input.rank));
	await userFacing(async () => roles.updateRole(id, input));
	await allRoles().refresh();
});

export const removeRole = command(idSchema, async (id) => {
	const user = requirePanel('roles.write');
	refuse(canDeleteRole(user, id));
	await userFacing(async () => roles.deleteRole(id));
	await allRoles().refresh();
});
