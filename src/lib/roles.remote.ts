import { command, query } from '$app/server';
import { idSchema } from '#lib/schemas/common.js';
import { roleInputSchema, roleUpdateSchema } from '#lib/schemas/roles.js';
import { requireAdmin } from '#lib/server/auth.js';
import { userFacing } from '#lib/server/http.js';
import * as roles from '#lib/server/roles.js';

export const allRoles = query(async () => {
	requireAdmin();
	return roles.listRoles();
});

export const addRole = command(roleInputSchema, async (input) => {
	requireAdmin();
	const role = await userFacing(async () => roles.createRole(input));
	await allRoles().refresh();
	return role.id;
});

export const saveRole = command(roleUpdateSchema, async ({ id, ...input }) => {
	requireAdmin();
	await userFacing(async () => roles.updateRole(id, input));
	await allRoles().refresh();
});

export const removeRole = command(idSchema, async (id) => {
	requireAdmin();
	await userFacing(async () => roles.deleteRole(id));
	await allRoles().refresh();
});
