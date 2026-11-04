import { describe, expect, it } from 'vitest';

import { newLines } from './log-files';

const lines = (from: number, to: number) =>
	Array.from({ length: to - from + 1 }, (_, i) => ({ n: from + i }));

describe('newLines', () => {
	it('adds only the lines after the ones shown', () => {
		expect(newLines(10, { total: 12, lines: lines(8, 12) })).toEqual(lines(11, 12));
	});

	it('waits when the follower is behind the tail that was read later', () => {
		expect(newLines(50, { total: 40, lines: [] })).toEqual([]);
		expect(newLines(50, { total: 45, lines: lines(41, 45) })).toEqual([]);
	});

	it('asks to reload when lines were skipped', () => {
		expect(newLines(10, { total: 300, lines: lines(101, 300) })).toBe('reload');
		expect(newLines(10, { total: 12, lines: [] })).toBe('reload');
	});
});
