import { describe, expect, it, vi } from 'vitest';

import { restartBackground } from './background';

describe('restartBackground', () => {
	it('stops the previous load before starting again', () => {
		const first = vi.fn();
		const second = vi.fn();
		restartBackground((onStop) => onStop(first));
		expect(first).not.toHaveBeenCalled();

		restartBackground((onStop) => onStop(second));
		expect(first).toHaveBeenCalledOnce();
		expect(second).not.toHaveBeenCalled();

		restartBackground(() => {});
		expect(first).toHaveBeenCalledOnce();
		expect(second).toHaveBeenCalledOnce();
	});

	it('keeps stopping the rest when one stop throws', () => {
		const after = vi.fn();
		restartBackground((onStop) => {
			onStop(() => {
				throw new Error('gone');
			});
			onStop(after);
		});
		restartBackground(() => {});
		expect(after).toHaveBeenCalledOnce();
	});
});
