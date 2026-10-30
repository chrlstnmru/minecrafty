import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { emptyRules, type Permission } from '#lib/permissions.js';
import * as A from './access';
import { db } from './db';
import { instances, roles, users } from './db/schema';
import * as G from './grants';
import * as R from './roles';
import * as U from './user-admin';
import { makeInstance } from '#test/instance.js';

let admin: A.Actor;
let boss: A.Actor; // rank 70, holds roles.write, roles.assign, users.write panel-wide
let junior: A.Actor; // rank 20
let peer: A.Actor; // rank 70
let one: number;

const rules = (allow: Permission[], deny: Permission[] = []) => ({ ...emptyRules(), allow, deny });
const role = (name: string, rank: number, allow: Permission[]) =>
	R.createRole({ name, description: '', rank, rules: rules(allow) }).id;
const give = (user: A.Actor, roleId: number, instanceId: number | null = null) => {
	const now = A.listAssignments(user.id).filter((a) => a.instanceId === instanceId);
	A.setAssignments(user.id, instanceId, [...now.map((a) => a.roleId), roleId]);
};

beforeEach(async () => {
	db.delete(instances).run();
	db.delete(users).run();
	db.delete(roles).where(eq(roles.builtIn, false)).run();
	const make = async (name: string, r: 'admin' | 'user') => {
		const u = await U.createAccount(name, 'a-long-password', r);
		return { id: u.id, role: u.role } satisfies A.Actor;
	};
	admin = await make('root', 'admin');
	boss = await make('boss', 'user');
	junior = await make('junior', 'user');
	peer = await make('peer', 'user');
	one = makeInstance().id;
	give(boss, role('Lead', 70, ['roles.write', 'roles.assign', 'users.write', 'files', 'logs']));
	give(peer, role('Lead 2', 70, ['files', 'logs']));
	give(junior, role('Junior', 20, ['logs']), one);
});

describe('canGrantRolePermissions', () => {
	it('lets an admin grant anything at any rank in range', () => {
		expect(G.canGrantRolePermissions(admin, rules(['users.write', 'files']), 99).ok).toBe(true);
	});

	it('needs roles.write', () => {
		expect(G.canGrantRolePermissions(junior, rules(['logs']), 5).ok).toBe(false);
		expect(G.canGrantRolePermissions(peer, rules(['logs']), 5).reason).toMatch(/manage roles/);
	});

	it('keeps owner-only permissions for admins', () => {
		const result = G.canGrantRolePermissions(boss, rules(['users.write']), 10);
		expect(result).toMatchObject({ ok: false });
		expect(result.reason).toMatch(/Only an admin/);
		expect(G.canGrantRolePermissions(boss, rules(['roles.write']), 10).ok).toBe(false);
	});

	it('only lets someone hand out what they hold panel-wide themselves', () => {
		expect(G.canGrantRolePermissions(boss, rules(['files', 'logs']), 10).ok).toBe(true);
		const result = G.canGrantRolePermissions(boss, rules(['backups']), 10);
		expect(result.ok).toBe(false);
		expect(result.reason).toMatch(/do not hold/);
		// implied permissions count: files brings view, which boss holds through files
		expect(G.canGrantRolePermissions(boss, rules(['view']), 10).ok).toBe(true);
	});

	it("needs a rank below the giver's own, within 0 to 99", () => {
		expect(G.canGrantRolePermissions(boss, rules(['logs']), 69).ok).toBe(true);
		expect(G.canGrantRolePermissions(boss, rules(['logs']), 70).ok).toBe(false);
		expect(G.canGrantRolePermissions(admin, rules(['logs']), 100).ok).toBe(false);
		expect(G.canGrantRolePermissions(admin, rules(['logs']), -1).ok).toBe(false);
		expect(G.canGrantRolePermissions(admin, rules(['logs']), 1.5).ok).toBe(false);
	});
});

describe('canEditRole and canDeleteRole', () => {
	it('lets someone edit a lower role but not one they hold or one ranked as high as them', () => {
		const lower = role('Lower', 40, ['logs']);
		expect(G.canEditRole(boss, lower, rules(['logs']), 40).ok).toBe(true);
		const held = A.listAssignments(boss.id)[0].roleId;
		expect(G.canEditRole(boss, held, rules(['logs']), 10).reason).toMatch(/you hold/);
		const same = role('Same', 70, ['logs']);
		expect(G.canEditRole(boss, same, rules(['logs']), 10).reason).toMatch(/as high/);
		expect(G.canEditRole(boss, lower, rules(['logs']), 80).ok).toBe(false);
	});

	it('never edits or deletes a built-in role, even for an admin', () => {
		const viewer = db.select().from(roles).where(eq(roles.name, 'Viewer')).get()!.id;
		expect(G.canEditRole(admin, viewer, rules(['logs']), 10).ok).toBe(false);
		expect(G.canDeleteRole(admin, viewer).ok).toBe(false);
	});

	it('applies the same rank and holding rules to deleting', () => {
		const lower = role('Lower', 40, ['logs']);
		expect(G.canDeleteRole(boss, lower).ok).toBe(true);
		expect(G.canDeleteRole(junior, lower).ok).toBe(false);
		expect(G.canDeleteRole(boss, A.listAssignments(boss.id)[0].roleId).ok).toBe(false);
		expect(G.canDeleteRole(admin, lower).ok).toBe(true);
	});
});

describe('canActOnRecord', () => {
	it('lets someone act on a person ranked below them', () => {
		expect(G.canActOnRecord(boss, 'users.write', { userId: junior.id }).ok).toBe(true);
	});

	it('refuses oneself, an equal rank, and anyone without the permission', () => {
		expect(G.canActOnRecord(boss, 'users.write', { userId: boss.id }).ok).toBe(false);
		expect(G.canActOnRecord(boss, 'users.write', { userId: peer.id }).reason).toMatch(/as high/);
		expect(G.canActOnRecord(peer, 'users.write', { userId: junior.id }).ok).toBe(false);
	});

	it('never lets a non-admin act on an admin, and lets an admin act on anyone else', () => {
		expect(G.canActOnRecord(boss, 'users.write', { userId: admin.id }).ok).toBe(false);
		expect(G.canActOnRecord(admin, 'users.write', { userId: peer.id }).ok).toBe(true);
		expect(G.canActOnRecord(admin, 'users.write', { userId: admin.id }).ok).toBe(false);
	});

	it("compares with the person's highest role of any kind, not just the one that grants it", () => {
		give(junior, role('Quiet but high', 80, ['logs']), one);
		expect(G.canActOnRecord(boss, 'users.write', { userId: junior.id }).ok).toBe(false);
	});

	it("uses the rank of the role that grants the permission, not the actor's highest", () => {
		// boss also holds a rank-95 role, but it does not grant users.write
		give(boss, role('Big but idle', 95, ['logs']));
		expect(G.canActOnRecord(boss, 'users.write', { userId: peer.id }).ok).toBe(false);
	});
});

describe('canAssignRole', () => {
	const target = (roleId: number, userId = junior.id) => ({
		subjectUserId: userId,
		roleId,
		instanceId: null as number | null
	});

	it('lets someone give a role ranked below theirs to a person below them', () => {
		expect(G.canAssignRole(boss, target(role('Mid', 50, ['logs']))).ok).toBe(true);
	});

	it('refuses a role ranked as high as theirs, or a person ranked as high', () => {
		expect(G.canAssignRole(boss, target(role('Top', 70, ['logs']))).ok).toBe(false);
		expect(G.canAssignRole(boss, target(role('Mid', 50, ['logs']), peer.id)).ok).toBe(false);
	});

	it('refuses without roles.assign, and for a deleted role', () => {
		const mid = role('Mid', 50, ['logs']);
		expect(G.canAssignRole(peer, target(mid)).ok).toBe(false);
		R.deleteRole(mid);
		expect(G.canAssignRole(boss, target(mid)).reason).toMatch(/not found/);
	});

	it('lets an admin assign any role', () => {
		expect(G.canAssignRole(admin, target(role('Top', 99, ['logs']))).ok).toBe(true);
	});
});

describe('canAddUser and canChangeAdminRole', () => {
	it('needs users.write, and making an admin is for admins', () => {
		expect(G.canAddUser(boss, 'user').ok).toBe(true);
		expect(G.canAddUser(boss, 'admin').ok).toBe(false);
		expect(G.canAddUser(junior, 'user').ok).toBe(false);
		expect(G.canAddUser(admin, 'admin').ok).toBe(true);
		expect(G.canChangeAdminRole(boss).ok).toBe(false);
		expect(G.canChangeAdminRole(admin).ok).toBe(true);
	});
});
