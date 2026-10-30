import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, formatPercent } from './format';

describe('formatBytes', () => {
	it('picks the unit and the number of decimals', () => {
		expect(formatBytes(0)).toBe('0 B');
		expect(formatBytes(1023)).toBe('1023 B');
		expect(formatBytes(1536)).toBe('1.5 KB');
		expect(formatBytes(5 * 1024 ** 2)).toBe('5.0 MB');
		expect(formatBytes(3.5 * 1024 ** 3)).toBe('3.50 GB');
	});
});

describe('formatDuration', () => {
	it.each([
		[0, '0s'],
		[999, '0s'],
		[45_000, '45s'],
		[59_999, '59s'],
		[60_000, '1m'],
		[12 * 60_000 + 59_000, '12m'],
		[3 * 3_600_000 + 20 * 60_000, '3h 20m'],
		[23 * 3_600_000 + 59 * 60_000, '23h 59m'],
		[26 * 3_600_000, '1d 2h'],
		[10 * 86_400_000, '10d 0h'],
		[-5000, '0s']
	])('%d ms is %s', (ms, text) => {
		expect(formatDuration(ms)).toBe(text);
	});
});

describe('formatPercent', () => {
	it('rounds, and says "<1%" for a little instead of a misleading 0', () => {
		expect(formatPercent(0)).toBe('0%');
		expect(formatPercent(0.4)).toBe('<1%');
		expect(formatPercent(1)).toBe('1%');
		expect(formatPercent(37.6)).toBe('38%');
		expect(formatPercent(100)).toBe('100%');
	});
});
