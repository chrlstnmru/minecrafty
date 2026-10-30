// What a signed-in user may do with a server. Admins may do everything everywhere; a user may do
// what an admin granted on each server. Plain data, so the page and the server read it alike.

export const PERMISSIONS = [
	'view',
	'logs',
	'console',
	'control',
	'files',
	'mods',
	'backups',
	'schedules',
	'settings'
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_INFO: Record<Permission, { label: string; description: string }> = {
	view: { label: 'View', description: 'See the server and its status' },
	logs: { label: 'Logs', description: 'Read and download the log files' },
	console: { label: 'Console', description: 'Read the console and run commands; manage players' },
	control: { label: 'Start and stop', description: 'Start, stop, restart and kill the server' },
	files: {
		label: 'Files',
		description: 'Browse, edit and upload files, and edit server.properties'
	},
	mods: {
		label: 'Mods',
		description: 'Install and update mods, plugins, resource packs and the modpack'
	},
	backups: { label: 'Backups', description: 'Create, download, restore and delete backups' },
	schedules: { label: 'Schedules', description: 'Create and change scheduled tasks' },
	settings: {
		label: 'Settings',
		description: 'Change name, memory and port, and update the loader'
	}
};

/** The permission each instance tab needs to be shown. */
export const MODULE_PERMISSION: Record<string, Permission> = {
	console: 'console',
	files: 'files',
	logs: 'logs',
	players: 'console',
	mods: 'mods',
	modpack: 'mods',
	'resource-packs': 'mods',
	backups: 'backups',
	schedules: 'schedules',
	properties: 'files',
	loader: 'settings',
	settings: 'settings'
};

/** Settings a role can lock: the user sees the value but cannot change it. */
export const SETTING_FIELDS = [
	'name',
	'port',
	'ram',
	'java',
	'jvmArgs',
	'autoStart',
	'loader'
] as const;
export type SettingField = (typeof SETTING_FIELDS)[number];

export const SETTING_INFO: Record<SettingField, { label: string; description: string }> = {
	name: { label: 'Name', description: 'The instance name' },
	port: { label: 'Port', description: 'The game port' },
	ram: { label: 'Memory', description: 'Minimum and maximum RAM' },
	java: { label: 'Java version', description: 'Which Java runs the server' },
	jvmArgs: { label: 'JVM arguments', description: 'Extra flags for the JVM' },
	autoStart: { label: 'Auto-start', description: 'Start with the panel' },
	loader: {
		label: 'Loader and Minecraft version',
		description: 'The Loader tab: update the build or the version'
	}
};

/** What a role says. A permission is allowed, denied (which wins) or left out, which is not granted. */
export type RoleRules = {
	allow: Permission[];
	deny: Permission[];
	/** `server.properties` keys the user may read but not change, such as difficulty or level-seed */
	lockedProperties: string[];
	lockedSettings: SettingField[];
};

export type Restrictions = { properties: string[]; settings: SettingField[] };

export const emptyRules = (): RoleRules => ({
	allow: [],
	deny: [],
	lockedProperties: [],
	lockedSettings: []
});

const strings = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

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
	const known = <T extends string>(list: readonly T[], value: unknown) =>
		list.filter((item) => strings(value).includes(item));
	return {
		allow: known(PERMISSIONS, r.allow),
		deny: known(PERMISSIONS, r.deny),
		lockedProperties: [...new Set(strings(r.lockedProperties))].filter((k) =>
			/^[A-Za-z0-9._-]{1,100}$/.test(k)
		),
		lockedSettings: known(SETTING_FIELDS, r.lockedSettings)
	};
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
		permissions: ['view', 'logs', 'console', 'control']
	},
	{
		name: 'Manager',
		description: 'Everything except settings',
		permissions: ['view', 'logs', 'console', 'control', 'files', 'mods', 'backups', 'schedules']
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
