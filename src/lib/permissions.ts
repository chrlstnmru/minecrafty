// What a signed-in user may do with a server. Admins may do everything everywhere; a user may do
// what an admin granted on each server. Plain data, so the page and the server read it alike.

export const PERMISSIONS = [
	'view',
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
	view: { label: 'View', description: 'See the server, its status and its logs' },
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
	logs: 'view',
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

/** Starting points for what to grant; any mix can be ticked by hand. */
export const ACCESS_PRESETS: { name: string; permissions: Permission[] }[] = [
	{ name: 'Viewer', permissions: ['view'] },
	{ name: 'Operator', permissions: ['view', 'console', 'control'] },
	{
		name: 'Manager',
		permissions: ['view', 'console', 'control', 'files', 'mods', 'backups', 'schedules']
	},
	{ name: 'Full', permissions: [...PERMISSIONS] }
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
