import { invalid } from '@sveltejs/kit';
import { command, form, query } from '$app/server';
import { idSchema } from '#lib/schemas/common.js';
import {
	addUserSchema,
	userAccessSchema,
	userPasswordSchema,
	userRoleSchema
} from '#lib/schemas/users.js';
import { listAccess, setAccess } from '#lib/server/access.js';
import { requireAdmin } from '#lib/server/auth.js';
import { userFacing } from '#lib/server/http.js';
import * as admin from '#lib/server/user-admin.js';

export const allUsers = query(async () => {
	requireAdmin();
	return admin.listUsers();
});

export const addAccount = form(addUserSchema, async ({ username, _password, role }) => {
	requireAdmin();
	try {
		await admin.addUser(username, _password, role);
	} catch (e) {
		invalid(e instanceof Error ? e.message : 'Could not add the user');
	}
	await allUsers().refresh();
});

export const setUserRole = command(userRoleSchema, async ({ id, role }) => {
	const actor = requireAdmin();
	await userFacing(() => admin.changeUser(id, { role }, actor.id));
	await allUsers().refresh();
});

export const setUserPassword = command(userPasswordSchema, async ({ id, password }) => {
	const actor = requireAdmin();
	await userFacing(() => admin.changeUser(id, { password }, actor.id));
});

export const deleteAccount = command(idSchema, async (id) => {
	const actor = requireAdmin();
	await userFacing(async () => admin.removeUser(id, actor.id));
	await allUsers().refresh();
});

export const userAccess = query(idSchema, async (userId) => {
	requireAdmin();
	return listAccess(userId);
});

export const setUserAccess = command(userAccessSchema, async ({ userId, instanceId, roleId }) => {
	requireAdmin();
	await userFacing(async () => setAccess(userId, instanceId, roleId));
	await userAccess(userId).refresh();
	await allUsers().refresh();
});
