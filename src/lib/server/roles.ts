import { and, count, eq, isNull } from 'drizzle-orm';
import { MAX_RANK, grantedBy, parseRules, type RoleRules } from '#lib/permissions.js';
import { db } from './db';
import { roleAssignments, roles } from './db/schema';

/** Every role with how many assignments use it, built-in ones first, then by rank. */
export function listRoles() {
	const used = new Map(
		db
			.select({ roleId: roleAssignments.roleId, n: count() })
			.from(roleAssignments)
			.groupBy(roleAssignments.roleId)
			.all()
			.map((r) => [r.roleId, r.n])
	);
	return db
		.select()
		.from(roles)
		.where(isNull(roles.deletedAt))
		.all()
		.map((r) => ({
			id: r.id,
			name: r.name,
			description: r.description,
			rank: r.rank,
			builtIn: r.builtIn,
			rules: parseRules(r.rules),
			used: used.get(r.id) ?? 0
		}))
		.sort((a, b) => Number(b.builtIn) - Number(a.builtIn) || b.rank - a.rank || a.id - b.id);
}

export type RoleInput = { name: string; description: string; rank: number; rules: RoleRules };

function clean(input: RoleInput) {
	const name = input.name.trim();
	if (!name) throw new Error('Give the role a name');
	if (!Number.isInteger(input.rank) || input.rank < 0 || input.rank > MAX_RANK)
		throw new Error(`Rank is a whole number from 0 to ${MAX_RANK}`);
	const rules = {
		allow: input.rules.allow.filter((p) => !input.rules.deny.includes(p)),
		deny: input.rules.deny
	};
	if (!grantedBy(rules).length) throw new Error('Allow at least one permission');
	return {
		name,
		description: input.description.trim(),
		rank: input.rank,
		rules: JSON.stringify(rules)
	};
}

const nameTaken = (e: unknown) => String(e).includes('UNIQUE');

export function createRole(input: RoleInput) {
	try {
		return db.insert(roles).values(clean(input)).returning().get();
	} catch (e) {
		if (nameTaken(e)) throw new Error('A role with that name exists');
		throw e;
	}
}

export function updateRole(id: number, input: RoleInput) {
	const role = db
		.select()
		.from(roles)
		.where(and(eq(roles.id, id), isNull(roles.deletedAt)))
		.get();
	if (!role) throw new Error('Role not found');
	if (role.builtIn) throw new Error('Built-in roles cannot be edited; duplicate it instead');
	try {
		db.update(roles).set(clean(input)).where(eq(roles.id, id)).run();
	} catch (e) {
		if (nameTaken(e)) throw new Error('A role with that name exists');
		throw e;
	}
}

/** Marks the role deleted. Assignments of it stay but no longer grant anything. */
export function deleteRole(id: number) {
	const role = db
		.select()
		.from(roles)
		.where(and(eq(roles.id, id), isNull(roles.deletedAt)))
		.get();
	if (!role) throw new Error('Role not found');
	if (role.builtIn) throw new Error('Built-in roles cannot be deleted');
	db.update(roles).set({ deletedAt: new Date() }).where(eq(roles.id, id)).run();
}

export const getRole = (id: number) =>
	db
		.select()
		.from(roles)
		.where(and(eq(roles.id, id), isNull(roles.deletedAt)))
		.get();
