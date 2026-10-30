import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeInstance } from '#test/instance.js';
import { ACCESS_PRESETS, PERMISSIONS, emptyRules, type RoleRules } from '#lib/permissions.js';
import * as A from './access';
import { db } from './db';
import { instancePermissions, instances, roles, sessions, users } from './db/schema';
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
const custom = (rules: Partial<RoleRules>, name = `role-${Math.random()}`) =>
	R.createRole({ name, description: '', rules: { ...emptyRules(), ...rules } }).id;

describe('permissionsFor', () => {
	it('gives an admin everything on every instance, with nothing granted', () => {
		expect(A.permissionsFor(admin, one)).toEqual([...PERMISSIONS]);
		expect(A.permissionsFor(admin, 999_999)).toEqual([...PERMISSIONS]);
	});

	it('gives a user nothing until a role is given', () => {
		expect(A.permissionsFor(alice, one)).toEqual([]);
	});

	it('gives a user what the role grants, on that instance only', () => {
		A.setAccess(alice.id, one, custom({ allow: ['files', 'backups'] }));
		expect(A.permissionsFor(alice, one)).toEqual(['view', 'files', 'backups']);
		expect(A.permissionsFor(alice, two)).toEqual([]);
		expect(A.permissionsFor(bob, one)).toEqual([]);
	});

	it('lets a deny beat an allow, and a denied view removes all access', () => {
		A.setAccess(alice.id, one, custom({ allow: ['files', 'backups', 'logs'], deny: ['backups'] }));
		expect(A.permissionsFor(alice, one)).toEqual(['view', 'logs', 'files']);
		const noView = db
			.insert(roles)
			.values({
				name: 'No view',
				rules: JSON.stringify({ ...emptyRules(), allow: ['files'], deny: ['view'] })
			})
			.returning()
			.get().id;
		A.setAccess(bob.id, one, noView);
		expect(A.permissionsFor(bob, one)).toEqual([]);
		expect(A.check(bob, one, 'files')).toBe('unknown');
	});

	it('treats damaged or unknown rules as no access rather than as everything', () => {
		const id = custom({ allow: ['files'] });
		A.setAccess(alice.id, one, id);
		db.update(roles).set({ rules: '{oops' }).where(eq(roles.id, id)).run();
		expect(A.permissionsFor(alice, one)).toEqual([]);
		db.update(roles)
			.set({ rules: JSON.stringify({ allow: ['files', 'root', 'admin'] }) })
			.where(eq(roles.id, id))
			.run();
		expect(A.permissionsFor(alice, one)).toEqual(['view', 'files']);
	});
});

describe('restrictionsFor', () => {
	it('has none for an admin and for a user without access', () => {
		expect(A.restrictionsFor(admin, one)).toEqual({ properties: [], settings: [] });
		expect(A.restrictionsFor(alice, one)).toEqual({ properties: [], settings: [] });
	});

	it('returns what the role locks', () => {
		A.setAccess(
			alice.id,
			one,
			custom({
				allow: ['files', 'settings'],
				lockedProperties: ['difficulty', 'level-seed'],
				lockedSettings: ['jvmArgs', 'loader']
			})
		);
		expect(A.restrictionsFor(alice, one)).toEqual({
			properties: ['difficulty', 'level-seed'],
			settings: ['jvmArgs', 'loader']
		});
		expect(A.restrictionsFor(alice, two)).toEqual({ properties: [], settings: [] });
	});
});

describe('check', () => {
	it('is ok when granted, denied when the server is visible but the permission is not', () => {
		A.setAccess(alice.id, one, roleOf('Viewer'));
		A.setAccess(alice.id, two, custom({ allow: ['files'] }));
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
		for (const p of PERMISSIONS) expect(A.check(admin, one, p)).toBe('ok');
	});
});

describe('visibleInstanceIds', () => {
	it('is null for an admin, meaning all', () => {
		expect(A.visibleInstanceIds(admin)).toBeNull();
	});

	it('lists the servers a user was given, and none before', () => {
		expect(A.visibleInstanceIds(alice)).toEqual([]);
		A.setAccess(alice.id, two, roleOf('Viewer'));
		expect(A.visibleInstanceIds(alice)).toEqual([two]);
		A.setAccess(alice.id, one, roleOf('Operator'));
		expect(A.visibleInstanceIds(alice)!.sort()).toEqual([one, two].sort());
		expect(A.visibleInstanceIds(bob)).toEqual([]);
	});
});

describe('setAccess', () => {
	it('gives a role, replaces it, and removes access with null', () => {
		A.setAccess(alice.id, one, roleOf('Viewer'));
		A.setAccess(alice.id, one, roleOf('Operator'));
		expect(A.listAccess(alice.id)).toEqual([{ instanceId: one, roleId: roleOf('Operator') }]);
		A.setAccess(alice.id, one, null);
		expect(A.listAccess(alice.id)).toEqual([]);
		expect(A.permissionsFor(alice, one)).toEqual([]);
	});

	it('refuses a role that does not exist', () => {
		expect(() => A.setAccess(alice.id, one, 999_999)).toThrow('Role not found');
	});

	it('goes when the instance or the user does', async () => {
		A.setAccess(alice.id, one, roleOf('Viewer'));
		A.setAccess(bob.id, two, roleOf('Viewer'));
		db.delete(instances).where(eq(instances.id, one)).run();
		expect(A.listAccess(alice.id)).toEqual([]);
		U.removeUser(bob.id, admin.id);
		expect(db.select().from(instancePermissions).all()).toEqual([]);
	});
});

describe('roles', () => {
	it('comes with the built-in roles, matching the presets', () => {
		const builtIn = R.listRoles().filter((r) => r.builtIn);
		expect(builtIn.map((r) => r.name)).toEqual(ACCESS_PRESETS.map((p) => p.name));
		for (const preset of ACCESS_PRESETS) {
			const role = builtIn.find((r) => r.name === preset.name)!;
			expect(role.rules.allow).toEqual(preset.permissions);
		}
	});

	it('creates, edits and deletes a custom role, counting where it is used', () => {
		const id = custom({ allow: ['console'], lockedProperties: ['gamemode'] }, 'Helper');
		R.updateRole(id, {
			name: 'Helper 2',
			description: 'x',
			rules: { ...emptyRules(), allow: ['console', 'logs'] }
		});
		A.setAccess(alice.id, one, id);
		expect(R.listRoles().find((r) => r.id === id)).toMatchObject({ name: 'Helper 2', used: 1 });
		expect(() => R.deleteRole(id)).toThrow('1 grant uses this role');
		A.setAccess(alice.id, one, null);
		R.deleteRole(id);
		expect(R.listRoles().find((r) => r.id === id)).toBeUndefined();
	});

	it('protects the built-in roles and refuses empty or duplicate roles', () => {
		const viewer = roleOf('Viewer');
		expect(() => R.deleteRole(viewer)).toThrow('Built-in');
		expect(() =>
			R.updateRole(viewer, {
				name: 'V',
				description: '',
				rules: { ...emptyRules(), allow: ['logs'] }
			})
		).toThrow('Built-in');
		expect(() => custom({}, 'Nothing')).toThrow('Allow at least one');
		expect(() => custom({ allow: ['files'], deny: ['files'] }, 'Cancelled')).toThrow(
			'Allow at least one'
		);
		expect(() => custom({ allow: ['files'] }, ' ')).toThrow('name');
		custom({ allow: ['files'] }, 'Once');
		expect(() => custom({ allow: ['files'] }, 'Once')).toThrow('exists');
	});
});

describe('user administration', () => {
	it('lists accounts with how many servers each was given', async () => {
		A.setAccess(alice.id, one, roleOf('Viewer'));
		A.setAccess(alice.id, two, roleOf('Viewer'));
		const list = U.listUsers();
		expect(list.map((u) => [u.username, u.role, u.instances])).toEqual([
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
