import { describe, expect, it } from 'vitest';

import { filterOptions, moveHighlight } from './combobox-search';

const versions = ['1.21.10', '1.21.4', '1.20.6', '1.20', '1.8.9'].map((v) => ({
	value: v,
	label: v
}));

describe('filterOptions', () => {
	it('keeps everything, in order, for an empty or blank query', () => {
		expect(filterOptions(versions, '')).toBe(versions);
		expect(filterOptions(versions, '   ')).toBe(versions);
	});

	it('matches a part of the label, ignoring case', () => {
		expect(filterOptions(versions, '1.20').map((o) => o.value)).toEqual(['1.20.6', '1.20']);
		expect(filterOptions([{ value: 'a', label: 'Fabric Loader' }], 'FABRIC')).toHaveLength(1);
	});

	it('needs every word to match, in any order', () => {
		const options = [
			{ value: '1', label: '14.1.1 · 26.2 · fabric' },
			{ value: '2', label: '14.1.1 · 26.2 · forge' }
		];
		expect(filterOptions(options, 'fabric 14.1').map((o) => o.value)).toEqual(['1']);
		expect(filterOptions(options, '26.2 14').map((o) => o.value)).toEqual(['1', '2']);
	});

	it('also searches the value', () => {
		expect(filterOptions([{ value: 'neoforge', label: 'NeoForge' }], 'neo')).toHaveLength(1);
		expect(filterOptions([{ value: 'id-77', label: 'Something' }], '77')).toHaveLength(1);
	});

	it('also searches text that is not shown', () => {
		const options = [
			{ value: '1', label: '14.1.1 · 26.2', search: 'fabric' },
			{ value: '2', label: '14.1.1 · 26.2', search: 'forge' }
		];
		expect(filterOptions(options, 'fabric').map((o) => o.value)).toEqual(['1']);
		expect(filterOptions(options, '26.2 forge').map((o) => o.value)).toEqual(['2']);
	});

	it('finds nothing when no option matches', () => {
		expect(filterOptions(versions, 'zzz')).toEqual([]);
	});
});

describe('moveHighlight', () => {
	it('steps by one and stops at both ends', () => {
		expect(moveHighlight(2, 'ArrowDown', 10)).toBe(3);
		expect(moveHighlight(9, 'ArrowDown', 10)).toBe(9);
		expect(moveHighlight(2, 'ArrowUp', 10)).toBe(1);
		expect(moveHighlight(0, 'ArrowUp', 10)).toBe(0);
	});

	it('jumps a page, to the start and to the end', () => {
		expect(moveHighlight(0, 'PageDown', 100)).toBe(8);
		expect(moveHighlight(95, 'PageDown', 100)).toBe(99);
		expect(moveHighlight(50, 'PageUp', 100)).toBe(42);
		expect(moveHighlight(3, 'PageUp', 100)).toBe(0);
		expect(moveHighlight(50, 'Home', 100)).toBe(0);
		expect(moveHighlight(50, 'End', 100)).toBe(99);
	});

	it('stays valid when the list shrinks or is empty, and ignores other keys', () => {
		expect(moveHighlight(40, 'a', 5)).toBe(4);
		expect(moveHighlight(3, 'ArrowDown', 0)).toBe(0);
		expect(moveHighlight(-1, 'x', 5)).toBe(0);
	});
});
