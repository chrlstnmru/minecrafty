// Minecrafty's own release tags: v0.2.0, or v0.2.0-rc.1 for a pre-release.

const TAG = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** A full release, which is all the updater installs. */
export const isStableTag = (tag: string) => TAG.test(tag) && !tag.includes('-');

/** Positive when `a` is newer than `b`, 0 when equal; null when either is not a release tag. */
export function compareReleases(a: string, b: string): number | null {
	const pa = TAG.exec(a);
	const pb = TAG.exec(b);
	if (!pa || !pb) return null;
	for (let i = 1; i <= 3; i++) {
		const d = Number(pa[i]) - Number(pb[i]);
		if (d) return d;
	}
	// a release is newer than its own pre-releases (v0.2.0 after v0.2.0-rc.1)
	if (!pa[4] || !pb[4]) return (pa[4] ? 0 : 1) - (pb[4] ? 0 : 1);
	return pa[4].localeCompare(pb[4], 'en', { numeric: true });
}
