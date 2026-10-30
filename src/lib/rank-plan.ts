/** Inclusive bounds of a stored role rank. */
export const MAX_RANK = 99;
export const MIN_RANK = 0;

export interface RankEntry {
	id: number;
	/** Null for a role that has no rank yet (being created). */
	rank: number | null;
	/** A locked role keeps its rank no matter what. */
	locked: boolean;
}

/**
 * Given roles in their wanted order (highest first), picks new ranks so the stored ranks match
 * that order while changing as few roles as possible: the longest run of roles already in order
 * keeps its ranks, and every other role gets a rank spaced evenly into the gap around it. Locked
 * roles always keep theirs. Returns only the roles whose rank changes, or null when no valid
 * ranks exist (an unlocked role was placed above a locked one with no room left between).
 * Ported from sv-erp's `rank-plan.ts`.
 */
export function planRanks(order: readonly RankEntry[]): Map<number, number> | null {
	// Sentinels just outside the valid range bound the first and last gaps.
	const seq = [
		{ id: -1, rank: MAX_RANK + 1, locked: true },
		...order,
		{ id: -1, rank: MIN_RANK - 1, locked: true }
	];

	// best[i]: the most roles that can keep their rank in seq[0..i] when seq[i] keeps its own.
	const best: number[] = Array.from({ length: seq.length }, () => -1);
	const prev: number[] = Array.from({ length: seq.length }, () => -1);
	best[0] = 1;

	for (let i = 1; i < seq.length; i++) {
		const rank = seq[i]!.rank;
		if (rank === null) continue;
		for (let j = i - 1; j >= 0; j--) {
			const above = seq[j]!;
			if (best[j]! >= 0 && above.rank! > rank) {
				// The roles between j and i need distinct ranks strictly between theirs.
				const room = above.rank! - rank - 1 >= i - j - 1;
				if (room && best[j]! + 1 > best[i]!) {
					best[i] = best[j]! + 1;
					prev[i] = j;
				}
			}
			// A locked role can't be skipped over: it must stay in the kept run.
			if (above.locked) break;
		}
		if (seq[i]!.locked && best[i]! < 0) return null;
	}

	const changes = new Map<number, number>();
	for (let i = seq.length - 1; i > 0; i = prev[i]!) {
		const top = prev[i]!;
		const gap = i - top - 1;
		const step = (seq[top]!.rank! - seq[i]!.rank!) / (gap + 1);
		for (let k = 1; k <= gap; k++) {
			const entry = seq[top + k]!;
			const rank = Math.floor(seq[top]!.rank! - step * k);
			if (rank !== entry.rank) changes.set(entry.id, rank);
		}
	}
	return changes;
}
