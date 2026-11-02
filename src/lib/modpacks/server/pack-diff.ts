export type Decision = 'nothing' | 'add' | 'update' | 'remove' | 'kept' | 'conflict';

/**
 * What an update does to one file, from three hashes: `installed` is what the old pack version
 * put there (undefined when it did not list the file), `wanted` is what the new version has
 * (undefined when it drops the file), and `current` is what is on disk now (null when missing).
 *
 * A file the player changed is never overwritten or removed: `kept` when the pack did not touch
 * it before, `conflict` when both the pack and the player changed it. A file the player deleted
 * stays deleted, and one that already matches the new version needs nothing.
 */
export function decide(
	installed: string | undefined,
	wanted: string | undefined,
	current: string | null
): Decision {
	if (wanted === undefined) {
		if (installed === undefined || current === null) return 'nothing';
		return current === installed ? 'remove' : 'kept';
	}
	if (installed === wanted) return 'nothing';
	if (installed === undefined) {
		if (current === null) return 'add';
		return current === wanted ? 'nothing' : 'kept';
	}
	if (current === null || current === wanted) return 'nothing';
	return current === installed ? 'update' : 'conflict';
}
