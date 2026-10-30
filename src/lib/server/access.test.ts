import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeInstance } from '#test/instance.js';
import { PERMISSIONS } from '#lib/permissions.js';
import * as A from './access';
import { db } from './db';
import { instancePermissions, instances, sessions, users } from './db/schema';
import * as U from './user-admin';

let admin: A.Actor;
let alice: A.Actor;
let bob: A.Actor;
let one: number;
let two: number;

beforeEach(async () => {
	db.delete(instances).run();
	db.delete(users).run();
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

describe('permissionsFor', () => {
	it('gives an admin everything on every instance, with nothing granted', () => {
		expect(A.permissionsFor(admin, one)).toEqual([...PERMISSIONS]);
		expect(A.permissionsFor(admin, 999_999)).toEqual([...PERMISSIONS]);
	});

	it('gives a user nothing until something is granted', () => {
		expect(A.permissionsFor(alice, one)).toEqual([]);
	});

	it('gives a user what was granted, on that instance only', () => {
		A.setAccess(alice.id, one, ['files', 'backups']);
		expect(A.permissionsFor(alice, one)).toEqual(['view', 'files', 'backups']);
		expect(A.permissionsFor(alice, two)).toEqual([]);
		expect(A.permissionsFor(bob, one)).toEqual([]);
	});

	it('treats a damaged row as no access rather than as everything', () => {
		db.insert(instancePermissions)
			.values({ userId: alice.id, instanceId: one, permissions: '{oops' })
			.run();
		expect(A.permissionsFor(alice, one)).toEqual([]);
		db.update(instancePermissions)
			.set({ permissions: '"files"' })
			.where(eq(instancePermissions.userId, alice.id))
			.run();
		expect(A.permissionsFor(alice, one)).toEqual([]);
	});

	it('ignores permission names it does not know, even in a stored row', () => {
		db.insert(instancePermissions)
			.values({
				userId: alice.id,
				instanceId: one,
				permissions: JSON.stringify(['files', 'root', 'admin'])
			})
			.run();
		expect(A.permissionsFor(alice, one)).toEqual(['view', 'files']);
	});
});

describe('check', () => {
	it('is ok when granted, denied when the server is visible but the permission is not', () => {
		A.setAccess(alice.id, one, ['view', 'files']);
		expect(A.check(alice, one, 'files')).toBe('ok');
		expect(A.check(alice, one, 'view')).toBe('ok');
		expect(A.check(alice, one, 'control')).toBe('denied');
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
		A.setAccess(alice.id, two, ['view']);
		expect(A.visibleInstanceIds(alice)).toEqual([two]);
		A.setAccess(alice.id, one, ['console']);
		expect(A.visibleInstanceIds(alice)!.sort()).toEqual([one, two].sort());
		expect(A.visibleInstanceIds(bob)).toEqual([]);
	});
});

describe('setAccess', () => {
	it('adds view, replaces what was there, and removes access with an empty list', () => {
		expect(A.setAccess(alice.id, one, ['mods'])).toEqual(['view', 'mods']);
		expect(A.setAccess(alice.id, one, ['control'])).toEqual(['view', 'control']);
		expect(A.listAccess(alice.id)).toEqual([{ instanceId: one, permissions: ['view', 'control'] }]);
		expect(A.setAccess(alice.id, one, [])).toEqual([]);
		expect(A.listAccess(alice.id)).toEqual([]);
		expect(A.permissionsFor(alice, one)).toEqual([]);
	});

	it('goes when the instance or the user does', async () => {
		A.setAccess(alice.id, one, ['view']);
		A.setAccess(bob.id, two, ['view']);
		db.delete(instances).where(eq(instances.id, one)).run();
		expect(A.listAccess(alice.id)).toEqual([]);
		U.removeUser(bob.id, admin.id);
		expect(db.select().from(instancePermissions).all()).toEqual([]);
	});
});

describe('user administration', () => {
	it('lists accounts with how many servers each was given', async () => {
		A.setAccess(alice.id, one, ['view']);
		A.setAccess(alice.id, two, ['view']);
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
