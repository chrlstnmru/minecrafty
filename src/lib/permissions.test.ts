import { describe, expect, it } from 'vitest';
import {
	ACCESS_PRESETS,
	MODULE_PERMISSION,
	PERMISSIONS,
	PERMISSION_INFO,
	emptyRules,
	grantedBy,
	parseRules,
	type Permission,
	firstAllowedModule,
	hasPermission,
	normalizePermissions
} from './permissions';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// the tab list imports icon components, which the test runner cannot load; its slugs are read as text
const slugs = [
	...readFileSync(join(import.meta.dirname, 'instance-modules.ts'), 'utf8').matchAll(
		/slug: '([a-z-]+)'/g
	)
].map((m) => m[1]);

describe('normalizePermissions', () => {
	it('keeps nothing for nothing, so no access stays no access', () => {
		expect(normalizePermissions([])).toEqual([]);
	});

	it('adds view whenever anything is granted', () => {
		expect(normalizePermissions(['files'])).toEqual(['view', 'files']);
		expect(normalizePermissions(['backups', 'control'])).toEqual(['view', 'control', 'backups']);
	});

	it('drops unknown names and repeats, and uses the usual order', () => {
		expect(normalizePermissions(['mods', 'bogus', 'view', 'mods', '__proto__'])).toEqual([
			'view',
			'mods'
		]);
		expect(normalizePermissions(['settings', 'console', 'view'])).toEqual([
			'view',
			'console',
			'settings'
		]);
	});

	it('is stable: normalising twice changes nothing', () => {
		const once = normalizePermissions(['schedules', 'console']);
		expect(normalizePermissions(once)).toEqual(once);
	});
});

describe('what is defined', () => {
	it('describes every permission', () => {
		for (const p of PERMISSIONS) {
			expect(PERMISSION_INFO[p].label).toBeTruthy();
			expect(PERMISSION_INFO[p].description).toBeTruthy();
		}
	});

	it('gates every instance tab, so a new tab cannot be left open to everyone', () => {
		expect(slugs.length).toBeGreaterThan(8);
		for (const slug of slugs) expect(MODULE_PERMISSION[slug], slug).toBeDefined();
	});

	it('every preset is a clean list that includes view', () => {
		for (const preset of ACCESS_PRESETS) {
			expect(normalizePermissions(preset.permissions)).toEqual(preset.permissions);
			expect(preset.permissions).toContain('view');
		}
		expect(ACCESS_PRESETS.at(-1)!.permissions).toEqual([...PERMISSIONS]);
	});
});

describe('hasPermission and firstAllowedModule', () => {
	it('checks a list', () => {
		expect(hasPermission(['view', 'files'], 'files')).toBe(true);
		expect(hasPermission(['view'], 'files')).toBe(false);
	});

	it('picks the first tab a user may open', () => {
		const order = slugs;
		expect(firstAllowedModule(['view'], order)).toBeUndefined();
		expect(firstAllowedModule(['view', 'logs'], order)).toBe('logs');
		expect(firstAllowedModule(['view', 'console'], order)).toBe('console');
		expect(firstAllowedModule(['view', 'logs', 'backups'], order)).toBe('logs');
		expect(firstAllowedModule([], order)).toBeUndefined();
	});
});

describe('role rules', () => {
	it('reads stored rules, dropping what it does not know', () => {
		expect(parseRules('{oops')).toEqual(emptyRules());
		expect(parseRules('"files"')).toEqual(emptyRules());
		expect(
			parseRules(
				JSON.stringify({
					allow: ['files', 'root'],
					deny: ['mods', 7],
					lockedProperties: ['difficulty', 'bad key!', 'difficulty'],
					lockedSettings: ['jvmArgs', 'nope']
				})
			)
		).toEqual({
			allow: ['files'],
			deny: ['mods'],
			lockedProperties: ['difficulty'],
			lockedSettings: ['jvmArgs']
		});
	});

	it('grants the allowed permissions minus the denied ones, with view', () => {
		const rules = {
			...emptyRules(),
			allow: ['files', 'backups'] as Permission[],
			deny: ['backups'] as Permission[]
		};
		expect(grantedBy(rules)).toEqual(['view', 'files']);
		expect(grantedBy({ ...rules, deny: ['view'] })).toEqual([]);
		expect(grantedBy(emptyRules())).toEqual([]);
	});
});
