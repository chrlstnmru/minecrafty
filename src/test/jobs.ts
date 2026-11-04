import { run } from '../lib/server/instance-jobs';

/** Holds the instance with a backup or restore until the returned function is called. */
export async function holdJob(id: number, kind: 'backup' | 'restore') {
	let letGo!: () => void;
	let started!: () => void;
	const gate = new Promise<void>((resolve) => (letGo = resolve));
	const running = new Promise<void>((resolve) => (started = resolve));
	const done = run(id, kind, async () => {
		started();
		await gate;
	});
	await running;
	return async () => {
		letGo();
		await done;
	};
}
