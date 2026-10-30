import { describe, expect, it } from 'vitest';
import { matches, nextRun, parseCron } from './cron';

const spec = (expression: string) => {
	const result = parseCron(expression);
	if (!result.ok) throw new Error(result.error);
	return result.spec;
};
const at = (y: number, mo: number, d: number, h = 0, min = 0) => new Date(y, mo - 1, d, h, min);
const next = (expression: string, from: Date) => nextRun(spec(expression), from);
const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b);

describe('parseCron', () => {
	it('reads numbers, lists, ranges and steps', () => {
		const s = spec('0,30 8-10 */10 1,6 1-5');
		expect(sorted(s.minutes)).toEqual([0, 30]);
		expect(sorted(s.hours)).toEqual([8, 9, 10]);
		expect(sorted(s.days)).toEqual([1, 11, 21, 31]);
		expect(sorted(s.months)).toEqual([1, 6]);
		expect(sorted(s.weekdays)).toEqual([1, 2, 3, 4, 5]);
	});

	it('steps within a range and from a start', () => {
		expect(sorted(spec('10-20/5 * * * *').minutes)).toEqual([10, 15, 20]);
		expect(sorted(spec('5/20 * * * *').minutes)).toEqual([5, 25, 45]);
		expect(sorted(spec('*/15 * * * *').minutes)).toEqual([0, 15, 30, 45]);
	});

	it('reads month and weekday names, in any case, and 7 as Sunday', () => {
		expect(sorted(spec('0 0 * JAN,mar mon-wed').months)).toEqual([1, 3]);
		expect(sorted(spec('0 0 * * mon-wed').weekdays)).toEqual([1, 2, 3]);
		expect(sorted(spec('0 0 * * 7').weekdays)).toEqual([0]);
		expect(sorted(spec('0 0 * * 0,7').weekdays)).toEqual([0]);
		expect(sorted(spec('0 0 * * *').weekdays)).toEqual([0, 1, 2, 3, 4, 5, 6]);
	});

	it('reads the @ shorthands', () => {
		expect(spec('@daily')).toEqual(spec('0 0 * * *'));
		expect(spec('@hourly')).toEqual(spec('0 * * * *'));
		expect(spec('@weekly')).toEqual(spec('0 0 * * 0'));
		expect(spec('@MONTHLY')).toEqual(spec('0 0 1 * *'));
	});

	it('copes with extra spaces', () => {
		expect(spec('  0   4  *  *  * ')).toEqual(spec('0 4 * * *'));
	});

	it.each([
		['', /five fields/],
		['* * * *', /five fields/],
		['* * * * * *', /five fields/],
		['60 * * * *', /outside 0-59/],
		['* 24 * * *', /outside 0-23/],
		['* * 0 * *', /outside 1-31/],
		['* * * 13 *', /outside 1-12/],
		['* * * * 8', /outside 0-7/],
		['*/0 * * * *', /step of 1 or more/],
		['*/x * * * *', /step of 1 or more/],
		['1/2/3 * * * *', /more than one step/],
		['5-1 * * * *', /counts backwards/],
		['a * * * *', /not a number/],
		['1,,2 * * * *', /empty entry/],
		['-1 * * * *', /not a number|empty/],
		['* * * foo *', /not a number/]
	])('refuses %j', (expression, reason) => {
		const result = parseCron(expression);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(reason);
	});
});

describe('matches', () => {
	it('is true only for the named minutes', () => {
		const s = spec('30 4 * * *');
		expect(matches(s, at(2026, 10, 30, 4, 30))).toBe(true);
		expect(matches(s, at(2026, 10, 30, 4, 31))).toBe(false);
		expect(matches(s, at(2026, 10, 30, 5, 30))).toBe(false);
	});

	it('is true for any second within the minute', () => {
		expect(matches(spec('30 4 * * *'), new Date(2026, 9, 30, 4, 30, 45))).toBe(true);
	});

	it('needs the day of the month or the weekday, not both, when both are given', () => {
		const s = spec('0 0 13 * 5');
		expect(matches(s, at(2026, 11, 13))).toBe(true);
		expect(matches(s, at(2026, 11, 6))).toBe(true);
		expect(matches(s, at(2026, 11, 7))).toBe(false);
	});

	it('uses only the one that is given when the other is a star', () => {
		expect(matches(spec('0 0 13 * *'), at(2026, 11, 13))).toBe(true);
		expect(matches(spec('0 0 13 * *'), at(2026, 11, 6))).toBe(false);
		expect(matches(spec('0 0 * * 5'), at(2026, 11, 6))).toBe(true);
		expect(matches(spec('0 0 * * 5'), at(2026, 11, 13))).toBe(true);
		expect(matches(spec('0 0 * * 5'), at(2026, 11, 14))).toBe(false);
	});
});

describe('nextRun', () => {
	it('finds the next daily time, today or tomorrow', () => {
		expect(next('0 4 * * *', at(2026, 10, 30, 3, 59))).toEqual(at(2026, 10, 30, 4, 0));
		expect(next('0 4 * * *', at(2026, 10, 30, 4, 0))).toEqual(at(2026, 10, 31, 4, 0));
		expect(next('0 4 * * *', at(2026, 10, 30, 15, 0))).toEqual(at(2026, 10, 31, 4, 0));
	});

	it('is always after, never at, the moment given', () => {
		const from = at(2026, 10, 30, 12, 0);
		expect(next('* * * * *', from)).toEqual(at(2026, 10, 30, 12, 1));
		expect(next('0 12 * * *', from)).toEqual(at(2026, 10, 31, 12, 0));
	});

	it('ignores the seconds of the moment given', () => {
		expect(next('* * * * *', new Date(2026, 9, 30, 12, 0, 59))).toEqual(at(2026, 10, 30, 12, 1));
	});

	it('steps through the hour', () => {
		expect(next('*/15 * * * *', at(2026, 10, 30, 12, 16))).toEqual(at(2026, 10, 30, 12, 30));
		expect(next('*/15 * * * *', at(2026, 10, 30, 12, 46))).toEqual(at(2026, 10, 30, 13, 0));
	});

	it('crosses month and year ends', () => {
		expect(next('0 0 1 * *', at(2026, 12, 31, 23, 59))).toEqual(at(2027, 1, 1, 0, 0));
		expect(next('0 0 * * *', at(2026, 12, 31, 23, 59))).toEqual(at(2027, 1, 1, 0, 0));
		expect(next('30 6 15 3 *', at(2026, 10, 30))).toEqual(at(2027, 3, 15, 6, 30));
	});

	it('finds a leap day years ahead', () => {
		expect(next('0 0 29 2 *', at(2026, 1, 1))).toEqual(at(2028, 2, 29, 0, 0));
	});

	it('picks the weekday', () => {
		// 2026-10-30 is a Friday; the next Monday is the 2nd
		expect(next('30 4 * * 1', at(2026, 10, 30, 12, 0))).toEqual(at(2026, 11, 2, 4, 30));
		expect(next('0 9 * * 1-5', at(2026, 10, 30, 12, 0))).toEqual(at(2026, 11, 2, 9, 0));
	});

	it('takes whichever of the two day fields comes first when both are given', () => {
		// the 1st, or any Friday: from Sunday 1 Nov 00:30, the next is Friday the 6th... or the 1st itself later
		expect(next('0 0 1 * 5', at(2026, 10, 30, 12, 0))).toEqual(at(2026, 11, 1, 0, 0));
		expect(next('0 0 1 * 5', at(2026, 11, 1, 0, 0))).toEqual(at(2026, 11, 6, 0, 0));
	});

	it('gives up on an expression that never happens', () => {
		expect(next('0 0 31 2 *', at(2026, 1, 1))).toBeNull();
		expect(next('0 0 30 2 *', at(2026, 1, 1))).toBeNull();
	});

	it('moves forward every time, so a schedule never fires twice for one minute', () => {
		const s = spec('*/7 * * * *');
		let t = at(2026, 10, 30, 0, 0);
		const seen: number[] = [];
		for (let i = 0; i < 20; i++) {
			const n = nextRun(s, t)!;
			expect(n.getTime()).toBeGreaterThan(t.getTime());
			seen.push(n.getTime());
			t = n;
		}
		expect(new Set(seen).size).toBe(20);
	});
});
