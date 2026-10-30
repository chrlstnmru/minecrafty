/**
 * The points of a trend line as an SVG `points` string, in a box of `width` by `height`.
 * `values` run oldest first and are scaled against `max`; a null is a gap (the line skips it).
 */
export function sparkPoints(values: (number | null)[], max: number, width: number, height: number) {
	if (values.length === 0 || max <= 0) return '';
	const step = values.length > 1 ? width / (values.length - 1) : 0;
	const points: string[] = [];
	values.forEach((value, i) => {
		if (value === null) return;
		const share = Math.min(1, Math.max(0, value / max));
		const x = values.length > 1 ? i * step : width / 2;
		points.push(`${round(x)},${round(height - share * height)}`);
	});
	return points.join(' ');
}

/** The same line closed along the bottom, to fill under it. */
export function sparkArea(values: (number | null)[], max: number, width: number, height: number) {
	const line = sparkPoints(values, max, width, height);
	if (!line) return '';
	const first = line.split(' ')[0].split(',')[0];
	const last = line.split(' ').at(-1)!.split(',')[0];
	return `${first},${height} ${line} ${last},${height}`;
}

const round = (n: number) => Math.round(n * 100) / 100;
