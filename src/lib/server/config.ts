import { basename, resolve } from 'node:path';

export const dataDir = resolve(process.env.MINECRAFTY_DATA ?? './data');

export const instancesDir = resolve(dataDir, 'instances');

// zip backups live outside the instance folder so a restore or delete of the server never touches them
export const backupsDir = resolve(dataDir, 'backups');

// the runner is a standalone Bun script started detached per instance
export const runnerEntry = resolve(process.env.MINECRAFTY_RUNNER ?? './runner/main.ts');

/** True when this is the compiled single binary, whose "runtime" is the app itself rather than `bun`. */
export const compiled = !/^bun(-debug|-profile)?(\.exe)?$/i.test(basename(process.execPath));

/**
 * The command that starts one instance's runner. A compiled binary starts itself as
 * `minecrafty runner <dir> <id>` (see src/instrumentation.server.ts); under Bun it runs the script.
 */
export const runnerCommand = (dir: string, id: number) =>
	compiled
		? [process.execPath, 'runner', dir, String(id)]
		: [process.execPath, runnerEntry, dir, String(id)];

// when set, every instance uses this Java instead of a managed Temurin download
export const javaOverride = process.env.MINECRAFTY_JAVA;
