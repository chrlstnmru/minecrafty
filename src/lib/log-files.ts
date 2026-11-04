/** Names the logs viewer serves: plain or gzip-rotated logs, never a path. */
export const LOG_NAME = /^[A-Za-z0-9][\w.-]{0,120}\.log(\.gz)?$/;

export const TAIL_LINES = 2000;

type Line = { n: number };

/**
 * What a frame of the followed log adds to `known` lines already shown, or `'reload'` when the
 * frame skips lines the page never got. A frame behind what is shown is normal: the tail was read
 * after the follower counted the file, and the follower catches up.
 */
export function newLines<T extends Line>(
	known: number,
	frame: { total: number; lines: T[] }
): T[] | 'reload' {
	if (frame.total <= known) return [];
	const first = frame.lines[0]?.n ?? frame.total + 1;
	if (first > known + 1) return 'reload';
	return frame.lines.filter((line) => line.n > known);
}
