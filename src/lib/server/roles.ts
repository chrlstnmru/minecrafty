import { and, countDistinct, eq, isNull } from 'drizzle-orm';
import { grantedBy, parseRules, type Permission } from '#lib/permissions.js';
import { planRanks, type RankEntry } from '#lib/rank-plan.js';
import { db } from './db';
import { roleAssignments, roles } from './db/schema';

/** Every live role, highest rank first, with how many people hold it. */
export function listRoles() {
	const counts = new Map(
		db
			.select({ roleId: roleAssignments.roleId, n: countDistinct(roleAssignments.userId) })
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
			/** what was picked for the role */
			permissions: parseRules(r.rules).allow,
			/** what it grants, with what the picked ones imply */
			effective: grantedBy(parseRules(r.rules)),
			memberCount: counts.get(r.id) ?? 0
		}))
		.sort((a, b) => b.rank - a.rank || a.id - b.id);
}

export type RoleRow = ReturnType<typeof listRoles>[number];

const nameTaken = (list: readonly { id: number; name: string }[], name: string, except?: number) =>
	list.some((r) => r.id !== except && r.name.toLowerCase() === name.toLowerCase());

const clean = (name: string) => {
	const trimmed = name.trim();
	if (!trimmed) throw new Error('Enter a name for the role.');
	return trimmed;
};

export const getRole = (id: number) =>
	db
		.select()
		.from(roles)
		.where(and(eq(roles.id, id), isNull(roles.deletedAt)))
		.get();

/** The ranks that put a new role below every existing one, re-ranking others only if no room is left. */
export function planBottom(list: readonly RoleRow[], locked: ReadonlySet<number> = new Set()) {
	const order: RankEntry[] = [
		...list.map((r) => ({ id: r.id, rank: r.rank, locked: locked.has(r.id) })),
		{ id: 0, rank: null, locked: false }
	];
	return planRanks(order);
}

/** Adds a role with no permissions at the bottom of the list. */
export function createRole(
	name: string,
	locked: ReadonlySet<number> = new Set(),
	permissions: readonly Permission[] = []
) {
	const list = listRoles();
	const trimmed = clean(name);
	if (nameTaken(list, trimmed))
		throw new Error(`A role named "${trimmed}" already exists. Pick another name.`);
	const plan = planBottom(list, locked);
	if (!plan) throw new Error('There is no room left below the other roles.');
	return db.transaction((tx) => {
		for (const [id, rank] of plan)
			if (id !== 0) tx.update(roles).set({ rank }).where(eq(roles.id, id)).run();
		return tx
			.insert(roles)
			.values({
				name: trimmed,
				rank: plan.get(0) ?? 0,
				rules: JSON.stringify({ allow: permissions })
			})
			.returning()
			.get();
	});
}

export type RoleEdit = {
	roleId: number;
	name: string;
	description: string;
	permissions: Permission[];
};

export type SavePlan = { ranks: Map<number, number>; edits: RoleEdit[] };

/**
 * Checks a save without writing anything: `order` lists every live role id, highest first, and
 * `locked` ids keep their rank. Returns the ranks that would change. Callers check who may do it.
 */
export function planSave(params: {
	order?: number[];
	edits: RoleEdit[];
	locked: ReadonlySet<number>;
}): SavePlan {
	const list = listRoles();
	const byId = new Map(list.map((r) => [r.id, r]));
	const stale = 'Roles changed since this page loaded. Reload it and try again.';
	if (new Set(params.edits.map((e) => e.roleId)).size !== params.edits.length)
		throw new Error(stale);
	if (params.edits.some((e) => !byId.has(e.roleId))) throw new Error(stale);

	let ranks = new Map<number, number>();
	if (params.order) {
		const order = params.order;
		if (
			order.length !== list.length ||
			new Set(order).size !== order.length ||
			!order.every((id) => byId.has(id))
		)
			throw new Error(stale);
		const plan = planRanks(
			order.map((id) => ({ id, rank: byId.get(id)!.rank, locked: params.locked.has(id) }))
		);
		if (!plan) throw new Error("You can't move a role above one you can't edit.");
		ranks = plan;
	}

	const editsById = new Map(params.edits.map((e) => [e.roleId, e]));
	const names = new Set<string>();
	for (const r of list) {
		const name = (editsById.get(r.id)?.name ?? r.name).trim();
		if (!name) throw new Error('Enter a name for the role.');
		if (names.has(name.toLowerCase()))
			throw new Error(`Two roles would both be named "${name}". Pick another name.`);
		names.add(name.toLowerCase());
	}
	return { ranks, edits: params.edits };
}

/** Writes a checked plan in one transaction: everything saves or nothing does. */
export function applySave(plan: SavePlan) {
	const byId = new Map(listRoles().map((r) => [r.id, r]));
	db.transaction((tx) => {
		// park renamed roles on their (unique) ids first, so swapping two names cannot collide
		for (const e of plan.edits)
			if (e.name.trim() !== byId.get(e.roleId)!.name)
				tx.update(roles)
					.set({ name: `#${e.roleId}` })
					.where(eq(roles.id, e.roleId))
					.run();
		for (const [id, rank] of plan.ranks)
			tx.update(roles).set({ rank }).where(eq(roles.id, id)).run();
		for (const e of plan.edits)
			tx.update(roles)
				.set({
					name: e.name.trim(),
					description: e.description.trim(),
					rules: JSON.stringify({ allow: e.permissions })
				})
				.where(eq(roles.id, e.roleId))
				.run();
	});
}

/** Marks the role deleted. Assignments of it stay but no longer grant anything. */
export function deleteRole(id: number) {
	const role = getRole(id);
	if (!role) throw new Error('Role not found');
	db.update(roles).set({ deletedAt: new Date() }).where(eq(roles.id, id)).run();
}
