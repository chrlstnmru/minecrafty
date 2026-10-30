import { describe, expect, it } from 'vitest';
import { rules, visibleItems } from './nav-access';

const items = [
	{ title: 'Dashboard' },
	{ title: 'Instances', rule: rules.instances },
	{ title: 'Modpack builder', rule: rules.modpacks },
	{ title: 'Backups', rule: rules.backups },
	{ title: 'Users', rule: rules.users },
	{ title: 'Settings', rule: rules.settings }
];
const titles = (held: string[], owner = false) =>
	visibleItems(items, { owner, held: new Set(held) }).map((i) => i.title);

describe('visibleItems', () => {
	it('shows only the dashboard to someone with no permissions', () => {
		expect(titles([])).toEqual(['Dashboard']);
	});

	it('shows Instances for any server permission or for creating instances', () => {
		expect(titles(['logs'])).toEqual(['Dashboard', 'Instances']);
		expect(titles(['instances.create'])).toEqual(['Dashboard', 'Instances']);
	});

	it('shows an item when the user holds a permission it is tied to', () => {
		expect(titles(['modpacks.read', 'logs'])).toEqual([
			'Dashboard',
			'Instances',
			'Modpack builder'
		]);
		expect(titles(['mods'])).not.toContain('Modpack builder');
		expect(titles(['backups'])).toContain('Backups');
		expect(titles(['users.read'])).toContain('Users');
	});

	it('keeps owner-only items from everyone but the owner', () => {
		expect(titles(['modpacks.read', 'users.read'])).not.toContain('Settings');
		expect(titles([], true)).toEqual(items.map((i) => i.title));
	});
});
