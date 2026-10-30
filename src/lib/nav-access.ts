import { INSTANCE_PERMISSIONS } from './permissions.js';

/** What decides whether a sidebar item shows. No rule means everyone sees it. */
export type NavRule = {
	/** shown when the user holds any of these, panel-wide or (for per-server ones) on any server */
	permission?: readonly string[];
	/** shown to the owner only */
	ownerOnly?: boolean;
};

export type NavContext = {
	owner: boolean;
	/** panel permissions plus the per-server ones held on at least one server */
	held: ReadonlySet<string>;
};

export const rules = {
	instances: { permission: ['instances.create', ...INSTANCE_PERMISSIONS] },
	mods: { permission: ['mods', 'modpack', 'resource-packs'] },
	backups: { permission: ['backups'] },
	schedules: { permission: ['schedules'] },
	users: { permission: ['users.read'] },
	roles: { permission: ['roles.read'] },
	settings: { ownerOnly: true }
} satisfies Record<string, NavRule>;

/** The items this user has any permission for; the owner sees all of them. */
export function visibleItems<T extends { rule?: NavRule }>(items: readonly T[], ctx: NavContext) {
	return items.filter(({ rule }) => {
		if (ctx.owner || !rule) return true;
		if (rule.ownerOnly) return false;
		return !rule.permission || rule.permission.some((p) => ctx.held.has(p));
	});
}
