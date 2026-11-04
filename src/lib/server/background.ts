// The panel's long-running work (timers, samplers), started from `init`.

const KEY = Symbol.for('minecrafty.background');

type Holder = { [KEY]?: (() => void)[] };

/**
 * Starts this load's background work, after stopping the previous load's. In dev, Vite reloads the
 * server code after an edit and SvelteKit runs `init` again in the same process; without this,
 * every earlier load's timers keep going (each stats sampler then holds its own RCON connection,
 * and scheduled tasks run once per load). `start` registers how to stop each thing it starts.
 */
export function restartBackground(start: (onStop: (stop: () => void) => void) => void) {
	const holder = globalThis as Holder;
	for (const stop of holder[KEY]?.splice(0) ?? []) {
		try {
			stop();
		} catch {
			// an earlier load's work that is already gone
		}
	}
	const stops: (() => void)[] = (holder[KEY] = []);
	start((stop) => stops.push(stop));
}
