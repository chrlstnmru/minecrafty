import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeInstance } from '#test/instance.js';
import {
	ACCESS_PRESETS,
	INSTANCE_PERMISSIONS,
	PERMISSIONS,
	emptyRules,
	type RoleRules
} from '#lib/permissions.js';
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
const custom = (rules: Partial<RoleRules>, name = `role-${Math.random()}`, rank = 10) =>
	R.createRole({ name, description: '', rank, rules: { ...emptyRules(), ...rules } }).id;

describe('permissionsFor', () => {
	it('gives an admin everything on every instance, with nothing granted', () => {
		expect(A.permissionsFor(admin, one)).toEqual([...INSTANCE_PERMISSIONS]);
		expect(A.permissionsFor(admin, 999_999)).toEqual([...INSTANCE_PERMISSIONS]);
	});

	it('gives a user nothing until a role is assigned', () => {
		expect(A.permissionsFor(alice, one)).toEqual([]);
	});

	it('gives what the role grants, plus what it implies, on that instance only', () => {
		A.setAssignments(alice.id, one, [custom({ allow: ['files', 'backups'] })]);
		expect(A.permissionsFor(alice, one)).toEqual(['view', 'files', 'backups']);
		expect(A.permissionsFor(alice, two)).toEqual([]);
		expect(A.permissionsFor(bob, one)).toEqual([]);
	});

	it('applies a panel-wide role to every instance', () => {
		A.setAssignments(alice.id, null, [roleOf('Operator')]);
		expect(A.permissionsFor(alice, one)).toEqual(A.permissionsFor(alice, two));
		expect(A.permissionsFor(alice, one)).toContain('control');
		expect(A.visibleInstanceIds(alice)!.sort()).toEqual([one, two].sort());
	});

	it('adds up the roles a user holds, and lets a deny in any of them win', () => {
		A.setAssignments(alice.id, one, [
			custom({ allow: ['files'] }),
			custom({ allow: ['backups', 'logs'], deny: ['backups'] }),
			custom({ allow: ['backups'] })
		]);
		expect(A.permissionsFor(alice, one)).toEqual(['view', 'logs', 'files']);
	});

	it('lets a deny on one server take back what a panel-wide role gave', () => {
		A.setAssignments(alice.id, null, [roleOf('Manager')]);
		A.setAssignments(alice.id, two, [custom({ allow: ['logs'], deny: ['files', 'view'] })]);
		expect(A.permissionsFor(alice, one)).toContain('files');
		expect(A.permissionsFor(alice, two)).not.toContain('files');
		expect(A.check(alice, two, 'logs')).toBe('unknown');
		expect(A.visibleInstanceIds(alice)).toEqual([one]);
	});

	it('leaves nothing on a server whose View is denied', () => {
		A.setAssignments(alice.id, one, [custom({ allow: ['files', 'backups'], deny: ['view'] })]);
		expect(A.permissionsFor(alice, one)).toEqual([]);
		expect(A.check(alice, one, 'files')).toBe('unknown');
	});

	it('ignores a role that was deleted', () => {
		const id = custom({ allow: ['files'] });
		A.setAssignments(alice.id, one, [id]);
		R.deleteRole(id);
		expect(A.permissionsFor(alice, one)).toEqual([]);
		expect(A.listAssignments(alice.id)).toEqual([]);
	});

	it('treats damaged or unknown rules as no access rather than as everything', () => {
		const id = custom({ allow: ['files'] });
		A.setAssignments(alice.id, one, [id]);
		db.update(roles).set({ rules: '{oops' }).where(eq(roles.id, id)).run();
		expect(A.permissionsFor(alice, one)).toEqual([]);
		db.update(roles)
			.set({ rules: JSON.stringify({ allow: ['files', 'root', 'admin'] }) })
			.where(eq(roles.id, id))
			.run();
		expect(A.permissionsFor(alice, one)).toEqual(['view', 'files']);
	});
});

describe('panel permissions', () => {
	it('come only from a role assigned panel-wide, never from a per-server one', () => {
		const id = custom({ allow: ['instances.create', 'logs'] });
		A.setAssignments(alice.id, one, [id]);
		expect(A.can(alice, 'instances.create')).toBe(false);
		expect(A.panelPermissionsFor(alice)).toEqual([]);
		A.setAssignments(alice.id, one, []);
		A.setAssignments(alice.id, null, [id]);
		expect(A.can(alice, 'instances.create')).toBe(true);
		expect(A.panelPermissionsFor(alice)).toEqual(['instances.create']);
	});

	it('bring what they imply, and an admin has them all', () => {
		A.setAssignments(alice.id, null, [custom({ allow: ['roles.assign'] })]);
		expect(A.panelPermissionsFor(alice)).toEqual(['users.read', 'roles.assign']);
		expect(A.panelPermissionsFor(admin)).toHaveLength(
			PERMISSIONS.length - INSTANCE_PERMISSIONS.length
		);
	});

	it('need an instance to ask about a per-server permission', () => {
		A.setAssignments(alice.id, null, [roleOf('Viewer')]);
		expect(A.can(alice, 'view')).toBe(false);
		expect(A.can(alice, 'view', { instanceId: one })).toBe(true);
	});
});

describe('check', () => {
	it('is ok when granted, denied when the server is visible but the permission is not', () => {
		A.setAssignments(alice.id, one, [roleOf('Viewer')]);
		A.setAssignments(alice.id, two, [custom({ allow: ['files'] })]);
		expect(A.check(alice, two, 'files')).toBe('ok');
		expect(A.check(alice, two, 'view')).toBe('ok');
		expect(A.check(alice, two, 'control')).toBe('denied');
		expect(A.check(alice, one, 'logs')).toBe('ok');
		expect(A.check(alice, one, 'files')).toBe('denied');
	});

	it('says "unknown" for a server the user has no access to, so its existence is not revealed', () => {
		expect(A.check(alice, one, 'view')).toBe('unknown');
		expect(A.check(alice, two, 'files')).toBe('unknown');
		expect(A.check(alice, 999_999, 'view')).toBe('unknown');
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
		const id = custom({ allow: ['logs'] });
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
			expect(role.rules.allow).toEqual(preset.permissions);
			expect(role.rank).toBe(preset.rank);
		}
	});

	it('creates, edits and deletes a custom role, counting where it is used', () => {
		const id = custom({ allow: ['console'] }, 'Helper');
		R.updateRole(id, {
			name: 'Helper 2',
			description: 'x',
			rank: 25,
			rules: { ...emptyRules(), allow: ['console', 'logs'] }
		});
		A.setAssignments(alice.id, one, [id]);
		expect(R.listRoles().find((r) => r.id === id)).toMatchObject({
			name: 'Helper 2',
			rank: 25,
			used: 1
		});
		R.deleteRole(id);
		expect(R.listRoles().find((r) => r.id === id)).toBeUndefined();
		expect(db.select().from(roles).where(eq(roles.id, id)).get()?.deletedAt).toBeTruthy();
	});

	it("frees a deleted role's name for a new one", () => {
		const id = custom({ allow: ['logs'] }, 'Reused');
		R.deleteRole(id);
		expect(() => custom({ allow: ['logs'] }, 'Reused')).not.toThrow();
	});

	it('protects the built-in roles and refuses empty, out-of-range or duplicate roles', () => {
		const viewer = roleOf('Viewer');
		expect(() => R.deleteRole(viewer)).toThrow('Built-in');
		expect(() =>
			R.updateRole(viewer, {
				name: 'V',
				description: '',
				rank: 1,
				rules: { ...emptyRules(), allow: ['logs'] }
			})
		).toThrow('Built-in');
		expect(() => custom({}, 'Nothing')).toThrow('Allow at least one');
		expect(() => custom({ allow: ['files'], deny: ['files', 'view'] }, 'Cancelled')).toThrow(
			'Allow at least one'
		);
		expect(() => custom({ allow: ['files'] }, ' ')).toThrow('name');
		expect(() => custom({ allow: ['files'] }, 'High', 100)).toThrow('Rank');
		custom({ allow: ['files'] }, 'Once');
		expect(() => custom({ allow: ['files'] }, 'Once')).toThrow('exists');
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
