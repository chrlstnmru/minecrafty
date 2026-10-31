import { describe, expect, it } from 'vitest';

import { compareVersions, updateKind } from './versions';

describe('compareVersions', () => {
	it('puts newer versions first, comparing numbers and not text', () => {
		expect(['1.9', '1.21.4', '1.21', '1.20.1', '26.1'].sort(compareVersions)).toEqual([
			'26.1',
			'1.21.4',
			'1.21',
			'1.20.1',
			'1.9'
		]);
		expect(compareVersions('1.21', '1.21.0')).toBe(0);
	});
});

describe('updateKind', () => {
	it('tells a build update, an upgrade and a downgrade apart', () => {
		expect(updateKind('1.21.4', '1.21.4')).toBe('build');
		expect(updateKind('1.21.4', '1.21.10')).toBe('upgrade');
		expect(updateKind('1.21.10', '1.21.4')).toBe('downgrade');
		expect(updateKind('1.21.4', '26.1')).toBe('upgrade');
	});
});
