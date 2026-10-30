import { INSTANCE_PERMISSIONS } from './permissions.js';

/** What decides whether a sidebar item shows. No rule means everyone sees it. */
export type NavRule = {
	/** shown when the user holds any of these, panel-wide or (for per-server ones) on any server */
	permission?: readonly string[];
	/** shown to admins only */
	adminOnly?: boolean;
};

export type NavContext = {
	admin: boolean;
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
	settings: { adminOnly: true }
} satisfies Record<string, NavRule>;

/** The items this user has any permission for; an admin sees all of them. */
export function visibleItems<T extends { rule?: NavRule }>(items: readonly T[], ctx: NavContext) {
	return items.filter(({ rule }) => {
		if (ctx.admin || !rule) return true;
		if (rule.adminOnly) return false;
		return !rule.permission || rule.permission.some((p) => ctx.held.has(p));
	});
}
