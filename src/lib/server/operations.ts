// What an instance is busy with besides running: one backup, restore or update at a time. Kept
// apart from backups.ts so that starting a server (instances.ts) can check it without a cycle.

export type Operation = 'backup' | 'restore' | 'update';

const busy = new Map<number, Operation>();

/** Takes the instance for one operation; the returned function gives it back. */
export function claim(instanceId: number, what: Operation) {
	const current = busy.get(instanceId);
	if (current === 'restore') throw new Error('A restore is in progress');
	if (current === 'update') throw new Error('A loader update is in progress');
	if (current === 'backup') throw new Error('A backup is already running');
	busy.set(instanceId, what);
	return () => busy.delete(instanceId);
}

/** The operation running on the instance right now, or null. */
export const busyWith = (instanceId: number) => busy.get(instanceId) ?? null;
