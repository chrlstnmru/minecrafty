import ArchiveIcon from '@tabler/icons-svelte/icons/archive';
import CalendarTimeIcon from '@tabler/icons-svelte/icons/calendar-time';
import FileCodeIcon from '@tabler/icons-svelte/icons/file-code';
import FileTextIcon from '@tabler/icons-svelte/icons/file-text';
import FolderIcon from '@tabler/icons-svelte/icons/folder';
import PackageIcon from '@tabler/icons-svelte/icons/package';
import PaletteIcon from '@tabler/icons-svelte/icons/palette';
import RefreshIcon from '@tabler/icons-svelte/icons/refresh';
import SettingsIcon from '@tabler/icons-svelte/icons/settings';
import TerminalIcon from '@tabler/icons-svelte/icons/terminal-2';
import UsersGroupIcon from '@tabler/icons-svelte/icons/users-group';
import { plannedSlugs } from './instance-slugs.js';
import type { Icon } from '@tabler/icons-svelte';

export type InstanceModule = {
	slug: string;
	title: string;
	icon: Icon;
	/** milestone (see docs/SPEC.md) that delivers the module; undefined once it exists */
	planned?: 3 | 4;
	description: string;
};

// order is the tab order; modules without `planned` have their own route under [id=integer]/
export const instanceModules: InstanceModule[] = [
	{
		slug: 'console',
		title: 'Console',
		icon: TerminalIcon,
		description: 'Live server output and command input.'
	},
	{
		slug: 'files',
		title: 'Files',
		icon: FolderIcon,

		description: 'Browse, edit, upload and download files inside the instance folder.'
	},
	{
		slug: 'logs',
		title: 'Logs',
		icon: FileTextIcon,
		description: 'Browse current and rotated log files with search and download.'
	},
	{
		slug: 'players',
		title: 'Players',
		icon: UsersGroupIcon,
		planned: 4,
		description: 'Online players, whitelist, operators and bans.'
	},
	{
		slug: 'mods',
		title: 'Mods',
		icon: PackageIcon,
		description: 'Search and install mods from Modrinth and CurseForge, and keep them updated.'
	},
	{
		slug: 'resource-packs',
		title: 'Resource packs',
		icon: PaletteIcon,

		description: 'Install resource packs and configure the server resource pack.'
	},
	{
		slug: 'backups',
		title: 'Backups',
		icon: ArchiveIcon,
		planned: 4,
		description: 'Manual and scheduled backups with retention and restore.'
	},
	{
		slug: 'schedules',
		title: 'Schedules',
		icon: CalendarTimeIcon,
		planned: 4,
		description: 'Cron tasks: start, stop, restart, backup or send a command.'
	},
	{
		slug: 'properties',
		title: 'Properties',
		icon: FileCodeIcon,
		planned: 4,
		description: 'Edit server.properties with form fields for the common keys.'
	},
	{
		slug: 'loader',
		title: 'Loader',
		icon: RefreshIcon,
		planned: 4,
		description: 'Update the loader build or Minecraft version, with a backup first.'
	},
	{
		slug: 'settings',
		title: 'Settings',
		icon: SettingsIcon,
		description: 'Name, memory, JVM arguments, port and auto-start.'
	}
];

// keep the matcher's list and the tab list in step
if (import.meta.env.DEV) {
	const planned = instanceModules.filter((m) => m.planned).map((m) => m.slug);
	if (planned.join() !== plannedSlugs.join())
		console.warn('instance-slugs.ts is out of date with instance-modules.ts');
}
