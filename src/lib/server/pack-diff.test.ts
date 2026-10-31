import { describe, expect, it } from 'vitest';

import { decide, type Decision } from './pack-diff';

// installed (A), wanted (B or A), current: a file's three hashes; "-" means none
const rows: [string, string | undefined, string | undefined, string | null, Decision][] = [
	['new file, missing', undefined, 'B', null, 'add'],
	['new file, player already has it', undefined, 'B', 'B', 'nothing'],
	['new file, player has their own', undefined, 'B', 'X', 'kept'],
	['unchanged by the pack', 'A', 'A', 'A', 'nothing'],
	['unchanged by the pack, player edited', 'A', 'A', 'X', 'nothing'],
	['unchanged by the pack, player deleted', 'A', 'A', null, 'nothing'],
	['changed by the pack, untouched', 'A', 'B', 'A', 'update'],
	['changed by the pack, player deleted', 'A', 'B', null, 'nothing'],
	['changed by the pack, player already has the new one', 'A', 'B', 'B', 'nothing'],
	['changed by the pack, player edited', 'A', 'B', 'X', 'conflict'],
	['dropped by the pack, untouched', 'A', undefined, 'A', 'remove'],
	['dropped by the pack, player edited', 'A', undefined, 'X', 'kept'],
	['dropped by the pack, already gone', 'A', undefined, null, 'nothing']
];

describe('decide', () => {
	it.each(rows)('%s', (_name, installed, wanted, current, expected) => {
		expect(decide(installed, wanted, current)).toBe(expected);
	});

	it('never removes or overwrites a file whose hash is not the one the pack installed', () => {
		for (const installed of [undefined, 'A']) {
			for (const wanted of [undefined, 'A', 'B']) {
				const decision = decide(installed, wanted, 'player');
				expect(decision === 'remove' || decision === 'update' || decision === 'add').toBe(false);
			}
		}
	});
});
