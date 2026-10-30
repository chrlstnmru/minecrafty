// What a signed-in user may do. The owner may do everything; anyone else may do what the roles
// assigned to them grant. Plain data, so the page and the server read it alike.

import {
	closureOf,
	definePermissions,
	validateRegistry,
	type Permission as PermissionDef
} from './permission-define.js';

export { MAX_RANK } from './rank-plan.js';

/** Per server: one for each instance tab, plus control. Holding any of them is what lets someone see the server. */
const instance = definePermissions({
	logs: {
		label: 'Logs',
		description: 'Read and download the log files',
		scope: 'instance'
	},
	console: {
		label: 'Console',
		description: 'Read the console and run commands',
		scope: 'instance'
	},
	players: {
		label: 'Players',
		description: 'See who is online; manage the whitelist, operators and bans',
		scope: 'instance'
	},
	control: {
		label: 'Start and stop',
		description: 'Start, stop, restart and kill the server',
		scope: 'instance'
	},
	files: {
		label: 'Files',
		description: 'Browse, edit, upload and download files',
		scope: 'instance'
	},
	properties: {
		label: 'Properties',
		description: 'Edit server.properties',
		scope: 'instance'
	},
	mods: {
		label: 'Mods',
		description: 'Install and update mods or plugins',
		scope: 'instance'
	},
	modpack: {
		label: 'Modpack',
		description: 'Update the server to another modpack version',
		scope: 'instance'
	},
	'resource-packs': {
		label: 'Resource packs',
		description: 'Install resource packs and set the server resource pack',
		scope: 'instance'
	},
	backups: {
		label: 'Backups',
		description: 'Create, download, restore and delete backups',
		scope: 'instance'
	},
	schedules: {
		label: 'Schedules',
		description: 'Create and change scheduled tasks',
		scope: 'instance'
	},
	audit: {
		label: 'Audit log',
		description: 'See who did what on this server',
		scope: 'instance'
	},
	loader: {
		label: 'Loader',
		description: 'Update the loader build or the Minecraft version',
		scope: 'instance'
	},
	settings: {
		label: 'Settings',
		description: 'Change name, memory, port, Java and JVM arguments',
		scope: 'instance'
	}
});

/** Across the whole panel; a role must be assigned panel-wide for these to apply. */
const panel = definePermissions({
	'host.view': {
		label: 'Host usage',
		description: 'See the host CPU, memory and storage on the dashboard',
		scope: 'panel'
	},
	'instances.create': {
		label: 'Create instances',
		description: 'Create servers, from scratch or from a modpack',
		scope: 'panel'
	},
	'instances.delete': {
		label: 'Delete instances',
		description: 'Delete a server and its files',
		scope: 'panel'
	},
	'audit.read': {
		label: 'Audit log',
		description: 'See who did what across the whole panel, including accounts and roles',
		scope: 'panel'
	},
	'modpacks.read': {
		label: 'See modpacks',
		description: 'Open the Modpack builder, see the packs in it and download them',
		scope: 'panel'
	},
	'modpacks.write': {
		label: 'Build modpacks',
		description: 'Create, change, import and delete packs in the Modpack builder',
		scope: 'panel',
		implies: ['modpacks.read']
	},
	'roles.read': {
		label: 'See roles',
		description: 'Open the Roles page and see what each role grants',
		scope: 'panel'
	},
	'users.read': {
		label: 'See users',
		description: 'Open the Users page and see accounts and roles',
		scope: 'panel'
	},
	'users.write': {
		label: 'Manage users',
		description: 'Add accounts, reset passwords and delete accounts of people ranked below you',
		scope: 'panel',
		implies: ['users.read'],
		hierarchical: true,
		ownerOnlyGrant: true
	},
	'roles.write': {
		label: 'Manage roles',
		description: 'Create, edit, reorder and delete roles ranked below you',
		scope: 'panel',
		implies: ['roles.read'],
		ownerOnlyGrant: true
	},
	'roles.assign': {
		label: 'Assign roles',
		description: 'Give people roles, panel-wide or on a server, ranked below you',
		scope: 'panel',
		implies: ['users.read', 'roles.read'],
		hierarchical: true
	}
});

export const registry = { ...instance, ...panel } as Record<
	keyof typeof instance | keyof typeof panel,
	PermissionDef<keyof typeof instance | keyof typeof panel>
>;
validateRegistry(registry);

export type InstancePermission = keyof typeof instance;
export type PanelPermission = keyof typeof panel;
export type Permission = InstancePermission | PanelPermission;

export const INSTANCE_PERMISSIONS = Object.keys(instance) as InstancePermission[];
export const PANEL_PERMISSIONS = Object.keys(panel) as PanelPermission[];
export const PERMISSIONS = [...INSTANCE_PERMISSIONS, ...PANEL_PERMISSIONS] as Permission[];

export const isInstancePermission = (key: Permission): key is InstancePermission =>
	registry[key].scope === 'instance';

/** The keys plus everything they imply. */
export const closure = (keys: Iterable<Permission>) => closureOf(registry, keys);

/** The permission each instance tab needs to be shown: the tab's own name. */
export const MODULE_PERMISSION: Record<string, InstancePermission> = {
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
	audit: 'audit',
	settings: 'settings'
};

/** What a role grants: the permissions picked for it. What they imply comes with them. */
export type RoleRules = { allow: Permission[] };

export const emptyRules = (): RoleRules => ({ allow: [] });

/** Reads stored rules, dropping what it does not know; damaged rules grant nothing. */
export function parseRules(text: string): RoleRules {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return emptyRules();
	}
	if (!raw || typeof raw !== 'object') return emptyRules();
	const { allow } = raw as Record<string, unknown>;
	return { allow: PERMISSIONS.filter((p) => Array.isArray(allow) && allow.includes(p)) };
}

/** What a role grants: the permissions picked and what they imply, in catalogue order. */
export function grantedBy(rules: RoleRules): Permission[] {
	const all = closure(rules.allow);
	return PERMISSIONS.filter((p) => all.has(p));
}

/** The section a permission sits under on the roles page: the resource it controls. */
export function permissionGroup(key: Permission): string {
	if (isInstancePermission(key)) return 'Server';
	const resource = key.split('.')[0];
	return resource.charAt(0).toUpperCase() + resource.slice(1);
}

export const hasPermission = (granted: readonly Permission[], needed: Permission) =>
	granted.includes(needed);

/** The first tab a user with these permissions can open, for where to send them. */
export function firstAllowedModule(granted: readonly Permission[], order: readonly string[]) {
	return order.find(
		(slug) => MODULE_PERMISSION[slug] && hasPermission(granted, MODULE_PERMISSION[slug])
	);
}
