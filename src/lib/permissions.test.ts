import { describe, expect, it } from 'vitest';
import {
	ACCESS_PRESETS,
	MODULE_PERMISSION,
	PERMISSIONS,
	emptyRules,
	grantedBy,
	permissionGroup,
	parseRules,
	firstAllowedModule,
	hasPermission,
	INSTANCE_PERMISSIONS,
	PANEL_PERMISSIONS,
	closure,
	isInstancePermission,
	registry
} from './permissions';
import { validateRegistry, type Permission as PermissionDef } from './permission-define';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// the tab list imports icon components, which the test runner cannot load; its slugs are read as text
const slugs = [
	...readFileSync(join(import.meta.dirname, 'instance-modules.ts'), 'utf8').matchAll(
		/slug: '([a-z-]+)'/g
	)
].map((m) => m[1]);

describe('the catalogue', () => {
	it('is valid: every implied permission exists, with no cycle, and no per-server one implies a panel one', () => {
		expect(() => validateRegistry(registry)).not.toThrow();
	});

	it('rejects an unknown implication, a cycle, and a per-server permission implying a panel one', () => {
		const make = (extra: Record<string, Partial<PermissionDef>>) => {
			const out: Record<string, PermissionDef> = {};
			for (const [key, value] of Object.entries(extra))
				out[key] = { key, label: key, scope: 'instance', ...value };
			return out;
		};
		expect(() => validateRegistry(make({ a: { implies: ['ghost'] } }))).toThrow('unknown');
		expect(() => validateRegistry(make({ a: { implies: ['b'] }, b: { implies: ['a'] } }))).toThrow(
			'cycle'
		);
		expect(() => validateRegistry(make({ a: { implies: ['b'] }, b: { scope: 'panel' } }))).toThrow(
			'panel-wide'
		);
		expect(() =>
			validateRegistry(make({ a: { scope: 'panel', implies: ['b'] }, b: { scope: 'instance' } }))
		).not.toThrow();
	});

	it('follows implications all the way down', () => {
		expect([...closure(['files'])].sort()).toEqual(['files', 'view']);
		expect([...closure(['roles.assign'])].sort()).toEqual([
			'roles.assign',
			'roles.read',
			'users.read'
		]);
		expect(closure([]).size).toBe(0);
		expect(closure(['view']).size).toBe(1);
	});

	it('every instance permission brings view, and no panel one is an instance one', () => {
		for (const p of INSTANCE_PERMISSIONS) expect(closure([p]).has('view')).toBe(true);
		for (const p of PANEL_PERMISSIONS) expect(isInstancePermission(p)).toBe(false);
	});
});

describe('what is defined', () => {
	it('describes every permission', () => {
		for (const p of PERMISSIONS) {
			expect(registry[p].label).toBeTruthy();
			expect(registry[p].description).toBeTruthy();
		}
	});

	it('gates every instance tab, so a new tab cannot be left open to everyone', () => {
		expect(slugs.length).toBeGreaterThan(8);
		for (const slug of slugs) expect(MODULE_PERMISSION[slug], slug).toBeDefined();
	});

	it('every preset is a clean list that includes view, with a rank', () => {
		for (const preset of ACCESS_PRESETS) {
			expect(closure(preset.permissions).size).toBe(preset.permissions.length);
			expect(preset.permissions).toContain('view');
			expect(preset.rank).toBeGreaterThanOrEqual(0);
			expect(preset.rank).toBeLessThanOrEqual(99);
		}
		expect(ACCESS_PRESETS.at(-1)!.permissions).toEqual([...INSTANCE_PERMISSIONS]);
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
	it('reads stored rules, dropping what it does not know and ignoring an old deny list', () => {
		expect(parseRules('{oops')).toEqual(emptyRules());
		expect(parseRules('"files"')).toEqual(emptyRules());
		expect(
			parseRules(JSON.stringify({ allow: ['files', 'root', 'logs'], deny: ['mods'], extra: 1 }))
		).toEqual({ allow: ['logs', 'files'] });
	});

	it('grants the picked permissions and what they imply, in catalogue order', () => {
		expect(grantedBy({ allow: ['files', 'backups'] })).toEqual(['view', 'files', 'backups']);
		expect(grantedBy({ allow: ['roles.write'] })).toEqual(['roles.read', 'roles.write']);
		expect(grantedBy(emptyRules())).toEqual([]);
	});

	it('groups permissions by the resource they control', () => {
		expect(permissionGroup('files')).toBe('Server');
		expect(permissionGroup('users.write')).toBe('Users');
		expect(permissionGroup('host.view')).toBe('Host');
		expect(permissionGroup('roles.assign')).toBe('Roles');
	});
});
