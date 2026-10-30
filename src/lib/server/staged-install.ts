import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Loader } from './loaders';

// New files are prepared in a staging folder next to the server and only moved in once
// everything they need was downloaded and installed, so a failure leaves the server as it was.

// Top-level names a loader's installer produces that a newer install must not leave behind: an
// old forge-*.jar or libraries/ folder would be picked up by launchArgs ahead of the new one.
export const STALE: Record<Loader, RegExp[]> = {
	vanilla: [],
	paper: [],
	purpur: [],
	fabric: [],
	quilt: [/^libraries$/, /^quilt-server-launch\.jar$/],
	forge: [/^libraries$/, /^forge-.*\.jar$/, /^minecraft_server.*\.jar$/, /^run\.(sh|bat)$/],
	neoforge: [/^libraries$/, /^minecraft_server.*\.jar$/, /^run\.(sh|bat)$/]
};

// files a loader writes once and the user then edits; an update must not overwrite them
const USER_FILES = new Set(['user_jvm_args.txt']);

/** Removes what the old install of `loader` left behind that would shadow a newer one. */
export function removeStale(server: string, loader: Loader) {
	for (const name of readdirSync(server))
		if (STALE[loader].some((pattern) => pattern.test(name)))
			rmSync(join(server, name), { recursive: true, force: true });
}

/**
 * Moves every file under `staging` to the same place under `server`, replacing a file that is
 * already there and creating folders as needed, then deletes `staging`. A folder in `staging`
 * is merged into the one in `server`, not swapped for it.
 */
export function mergeStaged(server: string, staging: string) {
	const walk = (rel: string) => {
		for (const name of readdirSync(join(staging, rel))) {
			const path = rel ? `${rel}/${name}` : name;
			if (statSync(join(staging, path)).isDirectory()) {
				walk(path);
				continue;
			}
			if (USER_FILES.has(path) && existsSync(join(server, path))) continue;
			const target = join(server, path);
			mkdirSync(dirname(target), { recursive: true });
			// a folder where the new file goes would make the rename fail
			if (existsSync(target) && statSync(target).isDirectory())
				rmSync(target, { recursive: true, force: true });
			renameSync(join(staging, path), target);
		}
	};
	walk('');
	rmSync(staging, { recursive: true, force: true });
}
