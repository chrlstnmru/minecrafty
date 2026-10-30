/** Sorts newest first (negative when `a` is newer); works for 1.21.4 and the newer 26.3 style. */
export function compareVersions(a: string, b: string) {
	const pa = a.split('.').map(Number);
	const pb = b.split('.').map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pb[i] ?? 0) - (pa[i] ?? 0);
		if (d) return d;
	}
	return 0;
}

export type UpdateKind = 'build' | 'upgrade' | 'downgrade';

/** What moving from `current` to `target` is, in Minecraft versions. */
export function updateKind(current: string, target: string): UpdateKind {
	const order = compareVersions(target, current);
	return order === 0 ? 'build' : order < 0 ? 'upgrade' : 'downgrade';
}
