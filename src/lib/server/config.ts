import { resolve } from 'node:path';

export const dataDir = resolve(process.env.MINECRAFTY_DATA ?? './data');

export const instancesDir = resolve(dataDir, 'instances');

// zip backups live outside the instance folder so a restore or delete of the server never touches them
export const backupsDir = resolve(dataDir, 'backups');

// the runner is a standalone Bun script started detached per instance (override for packaged builds)
export const runnerEntry = resolve(process.env.MINECRAFTY_RUNNER ?? './runner/main.ts');

// when set, every instance uses this Java instead of a managed Temurin download
export const javaOverride = process.env.MINECRAFTY_JAVA;
