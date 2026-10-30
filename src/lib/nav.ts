import ArchiveIcon from '@tabler/icons-svelte/icons/archive';
import CalendarTimeIcon from '@tabler/icons-svelte/icons/calendar-time';
import DashboardIcon from '@tabler/icons-svelte/icons/dashboard';
import PackageIcon from '@tabler/icons-svelte/icons/package';
import ServerIcon from '@tabler/icons-svelte/icons/server';
import SettingsIcon from '@tabler/icons-svelte/icons/settings';
import ShieldLockIcon from '@tabler/icons-svelte/icons/shield-lock';
import UsersIcon from '@tabler/icons-svelte/icons/users';
import type { Icon } from '@tabler/icons-svelte';

/** `permission` is a panel permission needed to see the item. */
export type NavItem = { title: string; url: string; icon: Icon; permission?: string };

export const navMain: NavItem[] = [
	{ title: 'Dashboard', url: '/', icon: DashboardIcon },
	{ title: 'Instances', url: '/instances', icon: ServerIcon },
	{ title: 'Mods', url: '/mods', icon: PackageIcon },
	{ title: 'Backups', url: '/backups', icon: ArchiveIcon },
	{ title: 'Schedules', url: '/schedules', icon: CalendarTimeIcon }
];

export const navSecondary: NavItem[] = [
	{ title: 'Users', url: '/users', icon: UsersIcon, permission: 'users.read' },
	{ title: 'Roles', url: '/roles', icon: ShieldLockIcon, permission: 'roles.read' },
	{ title: 'Settings', url: '/settings', icon: SettingsIcon }
];

export function isActive(url: string, pathname: string) {
	return url === '/' ? pathname === '/' : pathname === url || pathname.startsWith(`${url}/`);
}

export function findNavItem(pathname: string) {
	return [...navMain, ...navSecondary].find((item) => isActive(item.url, pathname));
}
