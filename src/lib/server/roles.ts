import { count, eq } from 'drizzle-orm';
import { grantedBy, parseRules, type RoleRules } from '#lib/permissions.js';
import { db } from './db';
import { instancePermissions, roles } from './db/schema';

/** Every role with how many grants use it, built-in ones first. */
export function listRoles() {
	const used = new Map(
		db
			.select({ roleId: instancePermissions.roleId, n: count() })
			.from(instancePermissions)
			.groupBy(instancePermissions.roleId)
			.all()
			.map((r) => [r.roleId, r.n])
	);
	return db
		.select()
		.from(roles)
		.orderBy(roles.id)
		.all()
		.map((r) => ({
			id: r.id,
			name: r.name,
			description: r.description,
			builtIn: r.builtIn,
			rules: parseRules(r.rules),
			used: used.get(r.id) ?? 0
		}))
		.sort((a, b) => Number(b.builtIn) - Number(a.builtIn) || a.id - b.id);
}

export type RoleInput = { name: string; description: string; rules: RoleRules };

function clean(input: RoleInput) {
	const name = input.name.trim();
	if (!name) throw new Error('Give the role a name');
	const rules = {
		...input.rules,
		// a permission cannot be both; deny wins, so it is dropped from the allowed list
		allow: input.rules.allow.filter((p) => !input.rules.deny.includes(p))
	};
	if (!grantedBy(rules).length) throw new Error('Allow at least one permission');
	return { name, description: input.description.trim(), rules: JSON.stringify(rules) };
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
	const role = db.select().from(roles).where(eq(roles.id, id)).get();
	if (!role) throw new Error('Role not found');
	if (role.builtIn) throw new Error('Built-in roles cannot be edited; duplicate it instead');
	try {
		db.update(roles).set(clean(input)).where(eq(roles.id, id)).run();
	} catch (e) {
		if (nameTaken(e)) throw new Error('A role with that name exists');
		throw e;
	}
}

export function deleteRole(id: number) {
	const role = db.select().from(roles).where(eq(roles.id, id)).get();
	if (!role) throw new Error('Role not found');
	if (role.builtIn) throw new Error('Built-in roles cannot be deleted');
	const inUse = db
		.select({ n: count() })
		.from(instancePermissions)
		.where(eq(instancePermissions.roleId, id))
		.get()?.n;
	if (inUse) throw new Error(`${inUse} ${inUse === 1 ? 'grant uses' : 'grants use'} this role`);
	db.delete(roles).where(eq(roles.id, id)).run();
}
