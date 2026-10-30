import ArchiveIcon from '@tabler/icons-svelte/icons/archive';
import CalendarTimeIcon from '@tabler/icons-svelte/icons/calendar-time';
import FileCodeIcon from '@tabler/icons-svelte/icons/file-code';
import FileTextIcon from '@tabler/icons-svelte/icons/file-text';
import FolderIcon from '@tabler/icons-svelte/icons/folder';
import PackageIcon from '@tabler/icons-svelte/icons/package';
import PackageImportIcon from '@tabler/icons-svelte/icons/package-import';
import PaletteIcon from '@tabler/icons-svelte/icons/palette';
import RefreshIcon from '@tabler/icons-svelte/icons/refresh';
import SettingsIcon from '@tabler/icons-svelte/icons/settings';
import TerminalIcon from '@tabler/icons-svelte/icons/terminal-2';
import UsersGroupIcon from '@tabler/icons-svelte/icons/users-group';
import type { Icon } from '@tabler/icons-svelte';

export type InstanceModule = {
	slug: string;
	title: string;
	icon: Icon;
	description: string;
};

// order is the tab order; every module has its own route under [id=integer]/
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
		description: 'Online players, whitelist, operators and bans.'
	},
	{
		slug: 'mods',
		title: 'Mods',
		icon: PackageIcon,
		description: 'Search and install mods from Modrinth and CurseForge, and keep them updated.'
	},
	{
		slug: 'modpack',
		title: 'Modpack',
		icon: PackageImportIcon,
		description: 'Update this server to another version of the modpack it was created from.'
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
		description:
			'Back up the server folder, download or restore a backup, and set how many to keep.'
	},
	{
		slug: 'schedules',
		title: 'Schedules',
		icon: CalendarTimeIcon,
		description: 'Cron tasks: start, stop, restart, backup or send a command.'
	},
	{
		slug: 'properties',
		title: 'Properties',
		icon: FileCodeIcon,
		description: 'Edit server.properties with form fields for the common keys.'
	},
	{
		slug: 'loader',
		title: 'Loader',
		icon: RefreshIcon,
		description: 'Update the loader build or Minecraft version, with a backup first.'
	},
	{
		slug: 'settings',
		title: 'Settings',
		icon: SettingsIcon,
		description: 'Name, memory, JVM arguments, port and auto-start.'
	}
];
