import { describe, expect, it } from 'vitest';
import { sparkArea, sparkPoints } from './spark';

describe('sparkPoints', () => {
	it('spreads the values along the width, with the high ones near the top', () => {
		expect(sparkPoints([0, 50, 100], 100, 100, 20)).toBe('0,20 50,10 100,0');
	});

	it('scales against the maximum given, not the largest value', () => {
		expect(sparkPoints([10, 20], 40, 10, 40)).toBe('0,30 10,20');
	});

	it('keeps a value above the maximum or below zero inside the box', () => {
		expect(sparkPoints([150, -5], 100, 10, 10)).toBe('0,0 10,10');
	});

	it('skips gaps without moving the points around them', () => {
		expect(sparkPoints([0, null, 100], 100, 100, 10)).toBe('0,10 100,0');
	});

	it('puts a single value in the middle, and gives nothing for no values or no scale', () => {
		expect(sparkPoints([50], 100, 100, 10)).toBe('50,5');
		expect(sparkPoints([], 100, 100, 10)).toBe('');
		expect(sparkPoints([1, 2], 0, 100, 10)).toBe('');
	});
});

describe('sparkArea', () => {
	it('closes the line along the bottom', () => {
		expect(sparkArea([0, 100], 100, 100, 10)).toBe('0,10 0,10 100,0 100,10');
	});

	it('is empty when the line is', () => {
		expect(sparkArea([null, null], 100, 100, 10)).toBe('');
	});
});
