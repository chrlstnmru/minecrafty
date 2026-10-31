import { describe, expect, it } from 'vitest';
import { compareReleases, isStableTag } from './release-version';

describe('release tags', () => {
	it('orders releases, with a release after its own pre-releases', () => {
		expect(compareReleases('v0.2.0', 'v0.1.9')).toBeGreaterThan(0);
		expect(compareReleases('v0.10.0', 'v0.9.0')).toBeGreaterThan(0);
		expect(compareReleases('v0.1.0', 'v0.1.0-rc.1')).toBeGreaterThan(0);
		expect(compareReleases('v0.1.0-rc.2', 'v0.1.0-rc.10')).toBeLessThan(0);
		expect(compareReleases('v1.0.0', 'v1.0.0')).toBe(0);
		expect(compareReleases('dev', 'v1.0.0')).toBeNull();
	});

	it('takes only full releases as stable', () => {
		expect(isStableTag('v0.2.0')).toBe(true);
		expect(isStableTag('v0.2.0-rc.1')).toBe(false);
		expect(isStableTag('0.2.0')).toBe(false);
		expect(isStableTag('v0.2.0; rm x')).toBe(false);
	});
});
