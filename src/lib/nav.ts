import HistoryIcon from '@tabler/icons-svelte/icons/history';
import DashboardIcon from '@tabler/icons-svelte/icons/dashboard';
import PackageIcon from '@tabler/icons-svelte/icons/package';
import ServerIcon from '@tabler/icons-svelte/icons/server';
import SettingsIcon from '@tabler/icons-svelte/icons/settings';
import ShieldLockIcon from '@tabler/icons-svelte/icons/shield-lock';
import UsersIcon from '@tabler/icons-svelte/icons/users';
import type { Icon } from '@tabler/icons-svelte';
import { rules, type NavRule } from './nav-access.js';

/** `rule` says who sees the item; without one, everyone does. */
export type NavItem = { title: string; url: string; icon: Icon; rule?: NavRule };

export const navMain: NavItem[] = [
	{ title: 'Dashboard', url: '/', icon: DashboardIcon },
	{ title: 'Instances', url: '/instances', icon: ServerIcon, rule: rules.instances },
	{ title: 'Modpack builder', url: '/modpacks', icon: PackageIcon, rule: rules.modpacks }
];

export const navSecondary: NavItem[] = [
	{ title: 'Users', url: '/users', icon: UsersIcon, rule: rules.users },
	{ title: 'Roles', url: '/roles', icon: ShieldLockIcon, rule: rules.roles },
	{ title: 'Audit log', url: '/audit', icon: HistoryIcon, rule: rules.audit },
	{ title: 'Settings', url: '/settings', icon: SettingsIcon, rule: rules.settings }
];

export function isActive(url: string, pathname: string) {
	return url === '/' ? pathname === '/' : pathname === url || pathname.startsWith(`${url}/`);
}

export function findNavItem(pathname: string) {
	return [...navMain, ...navSecondary].find((item) => isActive(item.url, pathname));
}
