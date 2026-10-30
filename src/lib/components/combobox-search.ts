/** Options whose label, value or extra search text contains every word of `query`, in their original order. */
export function filterOptions<T extends { value: string; label: string; search?: string }>(
	options: T[],
	query: string
) {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return options;
	return options.filter((option) => {
		const text = `${option.label} ${option.value} ${option.search ?? ''}`.toLowerCase();
		return words.every((word) => text.includes(word));
	});
}

const PAGE = 8;

/** Where the highlight goes for a navigation key, kept within `count` rows; `current` when the key is not one. */
export function moveHighlight(current: number, key: string, count: number) {
	if (count <= 0) return 0;
	const last = count - 1;
	switch (key) {
		case 'ArrowDown':
			return Math.min(last, current + 1);
		case 'ArrowUp':
			return Math.max(0, current - 1);
		case 'PageDown':
			return Math.min(last, current + PAGE);
		case 'PageUp':
			return Math.max(0, current - PAGE);
		case 'Home':
			return 0;
		case 'End':
			return last;
		default:
			return Math.min(Math.max(current, 0), last);
	}
}
