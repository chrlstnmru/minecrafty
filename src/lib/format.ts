/** A byte count as B, KB, MB or GB, one decimal place (two for GB). */
export const formatBytes = (bytes: number) =>
	bytes < 1024
		? `${bytes} B`
		: bytes < 1024 ** 2
			? `${(bytes / 1024).toFixed(1)} KB`
			: bytes < 1024 ** 3
				? `${(bytes / 1024 ** 2).toFixed(1)} MB`
				: `${(bytes / 1024 ** 3).toFixed(2)} GB`;

/** A span of time as its two largest parts: "45s", "12m", "3h 20m", "2d 4h". */
export function formatDuration(ms: number) {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ${minutes % 60}m`;
	return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** A percentage rounded to whole numbers, with "<1%" for a little rather than a misleading 0. */
export function formatPercent(value: number) {
	return value > 0 && value < 1 ? '<1%' : `${Math.round(value)}%`;
}
