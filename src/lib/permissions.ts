// What a signed-in user may do with a server. Admins may do everything everywhere; a user may do
// what an admin granted on each server. Plain data, so the page and the server read it alike.

export const PERMISSIONS = [
	'view',
	'logs',
	'console',
	'players',
	'control',
	'files',
	'properties',
	'mods',
	'modpack',
	'resource-packs',
	'backups',
	'schedules',
	'loader',
	'settings'
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** One per instance tab, plus view (the server itself) and control (start and stop). */
export const PERMISSION_INFO: Record<Permission, { label: string; description: string }> = {
	view: { label: 'View', description: 'See the server and its status' },
	logs: { label: 'Logs', description: 'Read and download the log files' },
	console: { label: 'Console', description: 'Read the console and run commands' },
	players: {
		label: 'Players',
		description: 'See who is online; manage the whitelist, operators and bans'
	},
	control: { label: 'Start and stop', description: 'Start, stop, restart and kill the server' },
	files: { label: 'Files', description: 'Browse, edit, upload and download files' },
	properties: { label: 'Properties', description: 'Edit server.properties' },
	mods: { label: 'Mods', description: 'Install and update mods or plugins' },
	modpack: { label: 'Modpack', description: 'Update the server to another modpack version' },
	'resource-packs': {
		label: 'Resource packs',
		description: 'Install resource packs and set the server resource pack'
	},
	backups: { label: 'Backups', description: 'Create, download, restore and delete backups' },
	schedules: { label: 'Schedules', description: 'Create and change scheduled tasks' },
	loader: { label: 'Loader', description: 'Update the loader build or the Minecraft version' },
	settings: { label: 'Settings', description: 'Change name, memory, port, Java and JVM arguments' }
};

/** The permission each instance tab needs to be shown: the tab's own name. */
export const MODULE_PERMISSION: Record<string, Permission> = {
	console: 'console',
	players: 'players',
	logs: 'logs',
	files: 'files',
	properties: 'properties',
	mods: 'mods',
	modpack: 'modpack',
	'resource-packs': 'resource-packs',
	backups: 'backups',
	schedules: 'schedules',
	loader: 'loader',
	settings: 'settings'
};

/** What a role says. A permission is allowed, denied (which wins) or left out, which is not granted. */
export type RoleRules = { allow: Permission[]; deny: Permission[] };

export const emptyRules = (): RoleRules => ({ allow: [], deny: [] });

/** Reads stored rules, dropping what it does not know; damaged rules grant nothing. */
export function parseRules(text: string): RoleRules {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return emptyRules();
	}
	if (!raw || typeof raw !== 'object') return emptyRules();
	const r = raw as Record<string, unknown>;
	const known = (value: unknown) =>
		PERMISSIONS.filter((p) => Array.isArray(value) && value.includes(p));
	return { allow: known(r.allow), deny: known(r.deny) };
}

/** What a role grants: the allowed permissions minus the denied ones, with view whenever any remain. */
export function grantedBy(rules: RoleRules): Permission[] {
	if (rules.deny.includes('view')) return [];
	return normalizePermissions(rules.allow.filter((p) => !rules.deny.includes(p)));
}

/** Starting points for a new role; the built-in roles are made from these. */
export const ACCESS_PRESETS: { name: string; description: string; permissions: Permission[] }[] = [
	{
		name: 'Viewer',
		description: 'See the server and read its logs',
		permissions: ['view', 'logs']
	},
	{
		name: 'Operator',
		description: 'Run the server and use the console',
		permissions: ['view', 'logs', 'console', 'players', 'control']
	},
	{
		name: 'Manager',
		description: 'Everything except the loader and settings',
		permissions: [
			'view',
			'logs',
			'console',
			'players',
			'control',
			'files',
			'properties',
			'mods',
			'modpack',
			'resource-packs',
			'backups',
			'schedules'
		]
	},
	{ name: 'Full', description: 'Everything on the server', permissions: [...PERMISSIONS] }
];

/**
 * A clean list of permissions: unknown names dropped, repeats merged, in the usual order, and
 * "view" included whenever anything is granted, since nothing else is usable without seeing the server.
 */
export function normalizePermissions(input: readonly string[]): Permission[] {
	const wanted = new Set(input);
	if (wanted.size === 0) return [];
	wanted.add('view');
	return PERMISSIONS.filter((p) => wanted.has(p));
}

export const hasPermission = (granted: readonly Permission[], needed: Permission) =>
	granted.includes(needed);

/** The first tab a user with these permissions can open, for where to send them. */
export function firstAllowedModule(granted: readonly Permission[], order: readonly string[]) {
	return order.find(
		(slug) => MODULE_PERMISSION[slug] && hasPermission(granted, MODULE_PERMISSION[slug])
	);
}
