import { describe, expect, it } from 'vitest';
import { MAX_RANK, planRanks, type RankEntry } from './rank-plan';

const entry = (id: number, rank: number | null, locked = false): RankEntry => ({
	id,
	rank,
	locked
});

describe('planRanks', () => {
	it('changes nothing when the order already matches the ranks', () => {
		expect(planRanks([entry(1, 90), entry(2, 50), entry(3, 10)])?.size).toBe(0);
	});

	it('moves only the role that was dragged, into the gap around it', () => {
		// 3 was dragged to the top
		const plan = planRanks([entry(3, 10), entry(1, 90), entry(2, 50)])!;
		expect([...plan.keys()]).toEqual([3]);
		expect(plan.get(3)!).toBeGreaterThan(90);
		expect(plan.get(3)!).toBeLessThanOrEqual(MAX_RANK);
	});

	it('puts a new role below every role, in the gap at the bottom', () => {
		const plan = planRanks([entry(1, 90), entry(2, 50), entry(0, null)])!;
		expect(plan.get(0)!).toBeLessThan(50);
		expect(plan.get(0)!).toBeGreaterThanOrEqual(0);
		expect(plan.size).toBe(1);
	});

	it('re-ranks others when there is no room at the bottom', () => {
		const plan = planRanks([entry(1, 2), entry(2, 1), entry(3, 0), entry(0, null)])!;
		expect(plan.has(0)).toBe(true);
		const ranks = [1, 2, 3, 0].map((id) => plan.get(id) ?? { 1: 2, 2: 1, 3: 0 }[id]!);
		expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
		expect(new Set(ranks).size).toBe(4);
	});

	it('never changes a locked role, and refuses to put an unlocked one past it with no room', () => {
		const plan = planRanks([entry(1, 90, true), entry(2, 50), entry(3, 10, true)])!;
		expect(plan.has(1)).toBe(false);
		expect(plan.has(3)).toBe(false);
		// 2 above a locked 90 and 91..99 is free, so it fits
		expect(planRanks([entry(2, 50), entry(1, 98, true), entry(4, 99, true)])).toBeNull();
	});

	it('keeps ranks distinct and in order after a shuffle', () => {
		const order = [entry(1, 50), entry(2, 49), entry(3, 48), entry(4, 47)];
		const shuffled = [order[3], order[0], order[2], order[1]];
		const plan = planRanks(shuffled)!;
		const final = shuffled.map((e) => plan.get(e.id) ?? e.rank!);
		expect([...final].sort((a, b) => b - a)).toEqual(final);
		expect(new Set(final).size).toBe(4);
		expect(Math.max(...final)).toBeLessThanOrEqual(MAX_RANK);
	});
});
