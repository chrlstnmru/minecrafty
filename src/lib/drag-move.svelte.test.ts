import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

import { DragMove } from './drag-move.svelte';
import { TREE_DRAG_TYPE } from './file-tree';

/** A drag event as far as DragMove reads it, carrying rows of a list or desktop files. */
function dragEvent(kind: 'rows' | 'files' = 'rows') {
	const data = new Map<string, string>();
	return {
		dataTransfer: {
			types: kind === 'rows' ? [TREE_DRAG_TYPE] : ['Files'],
			setData: (type: string, value: string) => data.set(type, value),
			getData: (type: string) => data.get(type) ?? '',
			effectAllowed: 'none',
			dropEffect: 'none'
		},
		preventDefault: vi.fn(),
		stopPropagation: vi.fn()
	} as unknown as DragEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

describe('DragMove', () => {
	it('lights up a folder the dragged row can go into, and moves it there on drop', () => {
		const onmove = vi.fn();
		const onend = vi.fn();
		const drag = new DragMove({ onmove: () => onmove, onend });

		drag.start(dragEvent(), 'config/a.toml');
		flushSync();
		expect(drag.dragged).toEqual(['config/a.toml']);

		const over = dragEvent();
		expect(drag.over(over, 'mods')).toBe(true);
		expect(over.preventDefault).toHaveBeenCalled();
		expect(drag.target).toBe('mods');

		expect(drag.drop(dragEvent(), 'mods')).toBe(true);
		expect(onmove).toHaveBeenCalledWith(['config/a.toml'], 'mods');
		expect(onend).toHaveBeenCalled();
		expect(drag.dragged).toBeNull();
		expect(drag.target).toBeNull();
	});

	it('refuses a folder dropped into itself, and moves nothing', () => {
		const onmove = vi.fn();
		const drag = new DragMove({ onmove: () => onmove });
		drag.start(dragEvent(), 'config');

		const over = dragEvent();
		expect(drag.over(over, 'config/sub')).toBe(true);
		expect(over.preventDefault).not.toHaveBeenCalled();
		expect(drag.target).toBeNull();

		drag.drop(dragEvent(), 'config/sub');
		expect(onmove).not.toHaveBeenCalled();
	});

	it('leaves desktop files, and drags with no mover, to whatever else takes them', () => {
		const drag = new DragMove({ onmove: () => vi.fn() });
		expect(drag.over(dragEvent('files'), 'mods')).toBe(false);
		expect(drag.drop(dragEvent('files'), 'mods')).toBe(false);

		const off = new DragMove({ onmove: () => undefined });
		off.start(dragEvent(), 'a.txt');
		expect(off.over(dragEvent(), 'mods')).toBe(false);
	});

	it('updates whatever reads its state', () => {
		const drag = new DragMove({ onmove: () => vi.fn() });
		const seen: (string | null)[] = [];
		const stop = $effect.root(() => {
			$effect(() => {
				seen.push(drag.target);
			});
		});
		flushSync();
		drag.start(dragEvent(), 'a.txt');
		drag.over(dragEvent(), 'mods');
		flushSync();
		drag.end();
		flushSync();
		stop();
		expect(seen).toEqual([null, 'mods', null]);
	});
});
