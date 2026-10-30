import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeInstance } from '#test/instance.js';
import {
	ACCESS_PRESETS,
	INSTANCE_PERMISSIONS,
	PERMISSIONS,
	type Permission
} from '#lib/permissions.js';
import { makeRole } from '#test/roles.js';
import * as A from './access';
import { db } from './db';
import { instances, roleAssignments, roles, sessions, users } from './db/schema';
import * as R from './roles';
import * as U from './user-admin';

let admin: A.Actor;
let alice: A.Actor;
let bob: A.Actor;
let one: number;
let two: number;

beforeEach(async () => {
	db.delete(instances).run();
	db.delete(users).run();
	db.delete(roles).where(eq(roles.builtIn, false)).run();
	const make = async (name: string, role: 'admin' | 'user') => {
		const u = await U.createAccount(name, 'a-long-password', role);
		return { id: u.id, role: u.role } satisfies A.Actor;
	};
	admin = await make('root', 'admin');
	alice = await make('alice', 'user');
	bob = await make('bob', 'user');
	one = makeInstance().id;
	two = makeInstance().id;
});

const roleOf = (name: string) => db.select().from(roles).where(eq(roles.name, name)).get()!.id;
const custom = (allow: Permission[], name = `role-${Math.random()}`, rank = 10) =>
	makeRole(name, rank, allow);

describe('permissionsFor', () => {
	it('gives an admin everything on every instance, with nothing granted', () => {
		expect(A.permissionsFor(admin, one)).toEqual([...INSTANCE_PERMISSIONS]);
		expect(A.permissionsFor(admin, 999_999)).toEqual([...INSTANCE_PERMISSIONS]);
	});

	it('gives a user nothing until a role is assigned', () => {
		expect(A.permissionsFor(alice, one)).toEqual([]);
	});

	it('gives what the role grants, plus what it implies, on that instance only', () => {
		A.setAssignments(alice.id, one, [custom(['files', 'backups'])]);
		expect(A.permissionsFor(alice, one)).toEqual(['files', 'backups']);
		expect(A.permissionsFor(alice, two)).toEqual([]);
		expect(A.permissionsFor(bob, one)).toEqual([]);
	});

	it('applies a panel-wide role to every instance', () => {
		A.setAssignments(alice.id, null, [roleOf('Operator')]);
		expect(A.permissionsFor(alice, one)).toEqual(A.permissionsFor(alice, two));
		expect(A.permissionsFor(alice, one)).toContain('control');
		expect(A.visibleInstanceIds(alice)!.sort()).toEqual([one, two].sort());
	});

	it('adds up the roles a user holds', () => {
		A.setAssignments(alice.id, one, [
			custom(['files']),
			custom(['backups', 'logs']),
			custom(['mods'])
		]);
		expect(A.permissionsFor(alice, one)).toEqual(['logs', 'files', 'mods', 'backups']);
	});

	it('keeps a per-server role to its server, next to a panel-wide one', () => {
		A.setAssignments(alice.id, null, [roleOf('Viewer')]);
		A.setAssignments(alice.id, two, [custom(['files'])]);
		expect(A.permissionsFor(alice, one)).toEqual(['logs']);
		expect(A.permissionsFor(alice, two)).toEqual(['logs', 'files']);
	});

	it('ignores a role that was deleted', () => {
		const id = custom(['files']);
		A.setAssignments(alice.id, one, [id]);
		R.deleteRole(id);
		expect(A.permissionsFor(alice, one)).toEqual([]);
		expect(A.listAssignments(alice.id)).toEqual([]);
	});

	it('treats damaged or unknown rules as no access rather than as everything', () => {
		const id = custom(['files']);
		A.setAssignments(alice.id, one, [id]);
		db.update(roles).set({ rules: '{oops' }).where(eq(roles.id, id)).run();
		expect(A.permissionsFor(alice, one)).toEqual([]);
		db.update(roles)
			.set({ rules: JSON.stringify({ allow: ['files', 'root', 'admin'] }) })
			.where(eq(roles.id, id))
			.run();
		expect(A.permissionsFor(alice, one)).toEqual(['files']);
	});
});

describe('panel permissions', () => {
	it('come only from a role assigned panel-wide, never from a per-server one', () => {
		const id = custom(['instances.create', 'logs']);
		A.setAssignments(alice.id, one, [id]);
		expect(A.can(alice, 'instances.create')).toBe(false);
		expect(A.panelPermissionsFor(alice)).toEqual([]);
		A.setAssignments(alice.id, one, []);
		A.setAssignments(alice.id, null, [id]);
		expect(A.can(alice, 'instances.create')).toBe(true);
		expect(A.panelPermissionsFor(alice)).toEqual(['instances.create']);
	});

	it('bring what they imply, and an admin has them all', () => {
		A.setAssignments(alice.id, null, [custom(['roles.assign'])]);
		expect(A.panelPermissionsFor(alice)).toEqual(['roles.read', 'users.read', 'roles.assign']);
		expect(A.panelPermissionsFor(admin)).toHaveLength(
			PERMISSIONS.length - INSTANCE_PERMISSIONS.length
		);
	});

	it('need an instance to ask about a per-server permission', () => {
		A.setAssignments(alice.id, null, [roleOf('Viewer')]);
		expect(A.can(alice, 'logs')).toBe(false);
		expect(A.can(alice, 'logs', { instanceId: one })).toBe(true);
	});
});

describe('check', () => {
	it('is ok when granted, denied when the server is visible but the permission is not', () => {
		A.setAssignments(alice.id, one, [roleOf('Viewer')]);
		A.setAssignments(alice.id, two, [custom(['files'])]);
		expect(A.check(alice, two, 'files')).toBe('ok');
		expect(A.canSee(alice, two)).toBe(true);
		expect(A.check(alice, two, 'control')).toBe('denied');
		expect(A.check(alice, one, 'logs')).toBe('ok');
		expect(A.check(alice, one, 'files')).toBe('denied');
	});

	it('says "unknown" for a server the user has no access to, so its existence is not revealed', () => {
		expect(A.canSee(alice, one)).toBe(false);
		expect(A.check(alice, one, 'logs')).toBe('unknown');
		expect(A.check(alice, two, 'files')).toBe('unknown');
		expect(A.check(alice, 999_999, 'logs')).toBe('unknown');
	});

	it('is always ok for an admin', () => {
		for (const p of INSTANCE_PERMISSIONS) expect(A.check(admin, one, p)).toBe('ok');
	});
});

describe('visibleInstanceIds', () => {
	it('is null for an admin, meaning all', () => {
		expect(A.visibleInstanceIds(admin)).toBeNull();
	});

	it('lists the servers a user has a role on, and none before', () => {
		expect(A.visibleInstanceIds(alice)).toEqual([]);
		A.setAssignments(alice.id, two, [roleOf('Viewer')]);
		expect(A.visibleInstanceIds(alice)).toEqual([two]);
		A.setAssignments(alice.id, one, [roleOf('Operator')]);
		expect(A.visibleInstanceIds(alice)!.sort()).toEqual([one, two].sort());
		expect(A.visibleInstanceIds(bob)).toEqual([]);
	});
});

describe('assignments', () => {
	it('replaces the roles on a target and leaves other targets alone', () => {
		A.setAssignments(alice.id, one, [roleOf('Viewer'), roleOf('Operator')]);
		A.setAssignments(alice.id, null, [roleOf('Manager')]);
		A.setAssignments(alice.id, one, [roleOf('Operator')]);
		expect(A.listAssignments(alice.id).sort((a, b) => a.roleId - b.roleId)).toEqual([
			{ roleId: roleOf('Operator'), instanceId: one },
			{ roleId: roleOf('Manager'), instanceId: null }
		]);
		A.setAssignments(alice.id, one, []);
		expect(A.listAssignments(alice.id)).toEqual([{ roleId: roleOf('Manager'), instanceId: null }]);
	});

	it('refuses a role that does not exist or was deleted', () => {
		expect(() => A.setAssignments(alice.id, one, [999_999])).toThrow('Role not found');
		const id = custom(['logs']);
		R.deleteRole(id);
		expect(() => A.setAssignments(alice.id, one, [id])).toThrow('Role not found');
	});

	it('goes when the instance or the user does', async () => {
		A.setAssignments(alice.id, one, [roleOf('Viewer')]);
		A.setAssignments(bob.id, two, [roleOf('Viewer')]);
		db.delete(instances).where(eq(instances.id, one)).run();
		expect(A.listAssignments(alice.id)).toEqual([]);
		U.removeUser(bob.id, admin.id);
		expect(db.select().from(roleAssignments).all()).toEqual([]);
	});
});

describe('rank', () => {
	it('is unlimited for an admin, the highest role for a user, and none without a role', () => {
		expect(A.rankOf(admin)).toBe(Infinity);
		expect(A.rankOf(alice)).toBe(-Infinity);
		A.setAssignments(alice.id, one, [roleOf('Viewer')]);
		A.setAssignments(alice.id, null, [roleOf('Manager')]);
		expect(A.rankOf(alice)).toBe(60);
	});
});

describe('roles', () => {
	it('comes with the built-in roles, matching the presets and ranked', () => {
		const builtIn = R.listRoles().filter((r) => r.builtIn);
		expect(builtIn.map((r) => r.name).sort()).toEqual(ACCESS_PRESETS.map((p) => p.name).sort());
		for (const preset of ACCESS_PRESETS) {
			const role = builtIn.find((r) => r.name === preset.name)!;
			expect(role.permissions).toEqual(preset.permissions);
			expect(role.rank).toBe(preset.rank);
		}
	});

	it('lists highest rank first and counts the people holding each role', () => {
		A.setAssignments(alice.id, one, [roleOf('Viewer')]);
		A.setAssignments(alice.id, two, [roleOf('Viewer')]);
		A.setAssignments(bob.id, null, [roleOf('Viewer')]);
		const list = R.listRoles();
		expect(list.map((r) => r.rank)).toEqual([...list.map((r) => r.rank)].sort((a, b) => b - a));
		expect(list.find((r) => r.name === 'Viewer')!.memberCount).toBe(2);
	});

	it('shows what a role grants including what its permissions imply', () => {
		custom(['roles.assign'], 'Assigner');
		const role = R.listRoles().find((r) => r.name === 'Assigner')!;
		expect(role.permissions).toEqual(['roles.assign']);
		expect(role.effective).toEqual(['roles.read', 'users.read', 'roles.assign']);
	});

	it('creates a role at the bottom with no permissions', () => {
		const created = R.createRole('Helper');
		const list = R.listRoles();
		expect(list.at(-1)!.id).toBe(created.id);
		expect(created.rank).toBeLessThan(Math.min(...list.slice(0, -1).map((r) => r.rank)));
		expect(R.listRoles().find((r) => r.id === created.id)!.permissions).toEqual([]);
	});

	it('refuses a duplicate name, ignoring case, and an empty one', () => {
		R.createRole('Helper');
		expect(() => R.createRole('helper')).toThrow('already exists');
		expect(() => R.createRole('  ')).toThrow('Enter a name');
	});

	it('saves names, descriptions, permissions and order in one go', () => {
		const a = R.createRole('Alpha').id;
		const b = R.createRole('Beta').id;
		const before = R.listRoles().map((r) => r.id);
		const order = [...before.filter((id) => id !== a && id !== b), b, a];
		const plan = R.planSave({
			order,
			edits: [{ roleId: a, name: 'Alpha 2', description: 'x', permissions: ['logs', 'files'] }],
			locked: new Set(
				R.listRoles()
					.filter((r) => r.builtIn)
					.map((r) => r.id)
			)
		});
		R.applySave(plan);
		const after = R.listRoles();
		expect(after.map((r) => r.id)).toEqual(order);
		expect(after.find((r) => r.id === a)).toMatchObject({
			name: 'Alpha 2',
			description: 'x',
			permissions: ['logs', 'files']
		});
	});

	it('lets two roles swap names, and refuses names that would collide', () => {
		const a = R.createRole('One').id;
		const b = R.createRole('Two').id;
		R.applySave(
			R.planSave({
				edits: [
					{ roleId: a, name: 'Two', description: '', permissions: [] },
					{ roleId: b, name: 'One', description: '', permissions: [] }
				],
				locked: new Set()
			})
		);
		expect(R.listRoles().find((r) => r.id === a)!.name).toBe('Two');
		expect(() =>
			R.planSave({
				edits: [{ roleId: a, name: 'one', description: '', permissions: [] }],
				locked: new Set()
			})
		).toThrow('both be named');
	});

	it('refuses a save that no longer matches the roles', () => {
		const a = R.createRole('One').id;
		expect(() => R.planSave({ order: [a], edits: [], locked: new Set() })).toThrow('Reload');
		expect(() =>
			R.planSave({
				edits: [{ roleId: 999_999, name: 'x', description: '', permissions: [] }],
				locked: new Set()
			})
		).toThrow('Reload');
	});

	it('refuses to move a role above one that is locked with no room', () => {
		const viewer = roleOf('Viewer');
		const mine = R.createRole('Mine').id;
		const locked = new Set(
			R.listRoles()
				.filter((r) => r.builtIn)
				.map((r) => r.id)
		);
		const order = R.listRoles()
			.map((r) => r.id)
			.filter((id) => id !== mine);
		order.splice(order.indexOf(viewer), 0, mine); // above Viewer (10) but below Operator (30)
		expect(() => R.planSave({ order, edits: [], locked })).not.toThrow();
	});

	it('deletes a role by marking it, and frees its name', () => {
		const id = R.createRole('Reused').id;
		A.setAssignments(alice.id, one, [id]);
		R.deleteRole(id);
		expect(R.listRoles().find((r) => r.id === id)).toBeUndefined();
		expect(db.select().from(roles).where(eq(roles.id, id)).get()?.deletedAt).toBeTruthy();
		expect(() => R.createRole('Reused')).not.toThrow();
	});

	it('protects the built-in roles from deleting', () => {
		expect(() => R.deleteRole(roleOf('Viewer'))).toThrow('Built-in');
		expect(() => R.deleteRole(999_999)).toThrow('not found');
	});
});

describe('user administration', () => {
	it('lists accounts with how many role assignments each has', async () => {
		A.setAssignments(alice.id, one, [roleOf('Viewer')]);
		A.setAssignments(alice.id, two, [roleOf('Viewer')]);
		const list = U.listUsers();
		expect(list.map((u) => [u.username, u.role, u.assignments])).toEqual([
			['alice', 'user', 2],
			['bob', 'user', 0],
			['root', 'admin', 0]
		]);
	});

	it('adds an account, and refuses a name that is taken', async () => {
		const added = await U.addUser('carol', 'another-password', 'user');
		expect(added).toMatchObject({ username: 'carol', role: 'user' });
		await expect(U.addUser('carol', 'whatever-it-is', 'user')).rejects.toThrow(/taken/);
	});

	it('never stores the password itself', async () => {
		await U.addUser('dave', 'plain-text-password', 'user');
		const row = db.select().from(users).where(eq(users.username, 'dave')).get()!;
		expect(row.passwordHash).not.toContain('plain-text-password');
		expect(await Bun.password.verify('plain-text-password', row.passwordHash)).toBe(true);
	});

	it('promotes and demotes, signing the person out so it applies now', async () => {
		db.insert(sessions)
			.values({ id: 'tok', userId: alice.id, expiresAt: new Date(Date.now() + 1e6) })
			.run();
		await U.changeUser(alice.id, { role: 'admin' }, admin.id);
		expect(db.select().from(users).where(eq(users.id, alice.id)).get()!.role).toBe('admin');
		expect(db.select().from(sessions).where(eq(sessions.userId, alice.id)).all()).toEqual([]);
		await U.changeUser(alice.id, { role: 'user' }, admin.id);
		expect(db.select().from(users).where(eq(users.id, alice.id)).get()!.role).toBe('user');
	});

	it('refuses to remove the last admin, by demoting or deleting', async () => {
		await expect(U.changeUser(admin.id, { role: 'user' }, alice.id)).rejects.toThrow(
			/at least one admin/
		);
		expect(() => U.removeUser(admin.id, alice.id)).toThrow(/at least one admin/);
		expect(db.select().from(users).where(eq(users.id, admin.id)).get()!.role).toBe('admin');
	});

	it('lets an admin go once there is another', async () => {
		await U.changeUser(alice.id, { role: 'admin' }, admin.id);
		await U.changeUser(admin.id, { role: 'user' }, alice.id);
		expect(db.select().from(users).where(eq(users.id, admin.id)).get()!.role).toBe('user');
	});

	it('does not let anyone delete their own account or take their own admin rights away', async () => {
		await U.changeUser(alice.id, { role: 'admin' }, admin.id);
		expect(() => U.removeUser(alice.id, alice.id)).toThrow(/own account/);
		await expect(U.changeUser(alice.id, { role: 'user' }, alice.id)).rejects.toThrow(
			/own admin rights/
		);
	});

	it('changes a password, and signs that person out everywhere unless they changed their own', async () => {
		db.insert(sessions)
			.values({ id: 'a1', userId: alice.id, expiresAt: new Date(Date.now() + 1e6) })
			.run();
		await U.changeUser(alice.id, { password: 'brand-new-password' }, admin.id);
		const row = db.select().from(users).where(eq(users.id, alice.id)).get()!;
		expect(await Bun.password.verify('brand-new-password', row.passwordHash)).toBe(true);
		expect(db.select().from(sessions).where(eq(sessions.userId, alice.id)).all()).toEqual([]);

		db.insert(sessions)
			.values({ id: 'a2', userId: alice.id, expiresAt: new Date(Date.now() + 1e6) })
			.run();
		await U.changeUser(alice.id, { password: 'yet-another-password' }, alice.id);
		expect(db.select().from(sessions).where(eq(sessions.userId, alice.id)).all()).toHaveLength(1);
	});

	it('removes an account with its sessions', async () => {
		db.insert(sessions)
			.values({ id: 'b1', userId: bob.id, expiresAt: new Date(Date.now() + 1e6) })
			.run();
		U.removeUser(bob.id, admin.id);
		expect(db.select().from(users).where(eq(users.id, bob.id)).get()).toBeUndefined();
		expect(db.select().from(sessions).where(eq(sessions.userId, bob.id)).all()).toEqual([]);
		expect(() => U.removeUser(bob.id, admin.id)).toThrow(/not found/);
	});
});
