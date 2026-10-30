// In-memory progress of background installs (modpack imports), keyed by instance id.
// Lost on restart on purpose: an install interrupted by a restart is marked failed at startup.

/** `bytes` says done and total are byte counts, which the page shows as sizes, not as a count of items. */
export type InstallProgress = { label: string; done: number; total: number; bytes?: boolean };

const progress = new Map<number, InstallProgress>();

export const setProgress = (id: number, value: InstallProgress) => progress.set(id, value);
export const clearProgress = (id: number) => progress.delete(id);
export const getProgress = (id: number) => progress.get(id) ?? null;
