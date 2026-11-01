// Dragging files and folders onto a folder to move them: the state the pack's file tree and the
// instance file manager's table share. The dragged paths are kept here as well as in the drag data,
// because a drop target cannot read the data until the drop but must know now whether to light up.

import { canMoveInto, carriedBy, encodeDrag, TREE_DRAG_TYPE } from '#lib/file-tree.js';

type Move = (paths: string[], folder: string) => void;

export class DragMove {
	/** The paths being dragged. */
	dragged = $state<string[] | null>(null);
	/** The drop target lit up now, by the name its owner gave it (null for none). */
	target = $state<string | null>(null);
	readonly #options: { onmove: () => Move | undefined; onend?: () => void };

	/**
	 * `onmove` is read at each drag, so it may change; with none, nothing is taken. `onend` runs when
	 * a drag is over, also on a drop, where the dragged row may be gone and never fires `dragend`.
	 */
	constructor(options: { onmove: () => Move | undefined; onend?: () => void }) {
		this.#options = options;
	}

	/** Whether the drag is of items from a list (not files dragged in from the desktop). */
	static carries(event: DragEvent) {
		return event.dataTransfer?.types.includes(TREE_DRAG_TYPE) ?? false;
	}

	/** Starts dragging the row at `path`, with everything chosen if it is one of several chosen. */
	start(event: DragEvent, path: string, chosen: ReadonlySet<string> = new Set()) {
		if (!event.dataTransfer) return;
		const carried = carriedBy(path, chosen);
		event.dataTransfer.setData(TREE_DRAG_TYPE, encodeDrag(carried));
		event.dataTransfer.effectAllowed = 'move';
		this.dragged = carried;
		if (carried.length > 1) {
			// the browser's picture of the row would say nothing about the others
			const badge = document.createElement('div');
			badge.textContent = `${carried.length} items`;
			badge.className =
				'fixed -top-96 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow';
			document.body.append(badge);
			event.dataTransfer.setDragImage(badge, 12, 12);
			setTimeout(() => badge.remove());
		}
	}

	end() {
		this.dragged = null;
		this.target = null;
		this.#options.onend?.();
	}

	/**
	 * Takes a dragged item hovering over `folder`; false when it is not one. `highlight` is the name
	 * to light up while it can be dropped there.
	 */
	over(event: DragEvent, folder: string, highlight: string | null = folder) {
		if (!this.#options.onmove() || !DragMove.carries(event)) return false;
		// stopped either way: whatever is behind this target would read it as a drop on itself
		event.stopPropagation();
		if (this.dragged === null || !canMoveInto(this.dragged, folder)) return true;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		this.target = highlight;
		return true;
	}

	/** Takes a dragged item dropped on `folder`; false when it is not one. */
	drop(event: DragEvent, folder: string) {
		const onmove = this.#options.onmove();
		if (!onmove || !DragMove.carries(event)) return false;
		event.stopPropagation();
		const from = this.dragged;
		this.end();
		if (from !== null && canMoveInto(from, folder)) {
			event.preventDefault();
			onmove(from, folder);
		}
		return true;
	}

	/** The drag left the target for something outside it (not for one of its own children). */
	leave(event: DragEvent) {
		if (!(event.currentTarget as Element).contains(event.relatedTarget as Node)) this.target = null;
	}
}
