import { error, invalid } from '@sveltejs/kit';
import { command, form, query } from '$app/server';
import { idSchema } from '#lib/schemas/common.js';
import {
	addUserSchema,
	grantRoleSchema,
	userAccessSchema,
	userIdsSchema,
	userPasswordSchema
} from '#lib/schemas/users.js';
import { listAssignments, setAssignments } from '#lib/server/access.js';
import { requirePanel, requireUser } from '#lib/server/auth.js';
import { canActOnRecord, canAddUser, canAssignRole, type GrantCheck } from '#lib/server/grants.js';
import { userFacing } from '#lib/server/http.js';
import * as admin from '#lib/server/user-admin.js';

const refuse = (check: GrantCheck) => {
	if (!check.ok) error(403, check.reason ?? 'Not allowed');
};

/** Every account, with what the caller may do to each (judged by rank). */
export const allUsers = query(async () => {
	const actor = requirePanel('users.read');
	return admin.listUsers().map((u) => ({
		...u,
		canManage: canActOnRecord(actor, 'users.write', { userId: u.id }).ok,
		canAssign: canActOnRecord(actor, 'roles.assign', { userId: u.id }).ok
	}));
});

export const addAccount = form(addUserSchema, async ({ username, _password }) => {
	const actor = requirePanel('users.write');
	const allowed = canAddUser(actor);
	if (!allowed.ok) invalid(allowed.reason ?? 'Not allowed');
	try {
		await admin.addUser(username, _password);
	} catch (e) {
		invalid(e instanceof Error ? e.message : 'Could not add the user');
	}
	await allUsers().refresh();
});

export const setUserPassword = command(userPasswordSchema, async ({ id, password }) => {
	// anyone may change their own password; someone else's needs users.write and more rank
	const me = requireUser();
	if (id !== me.id) {
		const actor = requirePanel('users.write');
		refuse(canActOnRecord(actor, 'users.write', { userId: id }));
	}
	await userFacing(() => admin.changeUser(id, { password }, me.id));
});

/** Deletes several accounts. Each one is checked on its own; the ones the caller may not delete are skipped and reported. */
export const deleteAccounts = command(userIdsSchema, async (ids) => {
	const actor = requirePanel('users.write');
	const done: number[] = [];
	const skipped: { id: number; reason: string }[] = [];
	for (const id of ids) {
		const check = canActOnRecord(actor, 'users.write', { userId: id });
		if (!check.ok) {
			skipped.push({ id, reason: check.reason ?? 'Not allowed' });
			continue;
		}
		try {
			admin.removeUser(id, actor.id);
			done.push(id);
		} catch (e) {
			skipped.push({ id, reason: e instanceof Error ? e.message : 'Could not delete' });
		}
	}
	await allUsers().refresh();
	return { deleted: done.length, skipped };
});

/** Gives one role to several people, on a server or panel-wide (null), keeping the roles they already have there. */
export const grantRoleToUsers = command(
	grantRoleSchema,
	async ({ userIds, roleId, instanceId }) => {
		const actor = requirePanel('roles.assign');
		let granted = 0;
		const skipped: { id: number; reason: string }[] = [];
		for (const id of userIds) {
			const check = canAssignRole(actor, { subjectUserId: id, roleId, instanceId });
			if (!check.ok) {
				skipped.push({ id, reason: check.reason ?? 'Not allowed' });
				continue;
			}
			const have = listAssignments(id)
				.filter((a) => a.instanceId === instanceId)
				.map((a) => a.roleId);
			setAssignments(id, instanceId, [...new Set([...have, roleId])]);
			granted++;
		}
		await allUsers().refresh();
		return { granted, skipped };
	}
);

export const userAccess = query(idSchema, async (userId) => {
	requirePanel('users.read');
	return listAssignments(userId);
});

/** Sets the roles a user has on an instance (null: panel-wide). Each role added or removed must be one the caller may assign. */
export const setUserAccess = command(userAccessSchema, async ({ userId, instanceId, roleIds }) => {
	const actor = requirePanel('roles.assign');
	const before = listAssignments(userId)
		.filter((a) => a.instanceId === instanceId)
		.map((a) => a.roleId);
	const changed = [
		...roleIds.filter((r) => !before.includes(r)),
		...before.filter((r) => !roleIds.includes(r))
	];
	for (const roleId of changed)
		refuse(canAssignRole(actor, { subjectUserId: userId, roleId, instanceId }));
	await userFacing(async () => setAssignments(userId, instanceId, roleIds));
	await userAccess(userId).refresh();
	await allUsers().refresh();
});
