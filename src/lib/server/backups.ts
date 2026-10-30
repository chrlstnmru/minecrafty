import {
	createWriteStream,
	existsSync,
	mkdirSync,
	renameSync,
	rmSync,
	statSync,
	statfsSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { backupsDir } from './config';
import { db } from './db';
import { backups, instances } from './db/schema';
import { isRunning } from './files';
import { getInstance, instanceDir, serverDir } from './instances';
import * as runner from './runner-client';
import type { Subscription } from './runner-client';
import type { ServerMessage } from '#runner/protocol.js';
import { listZipEntries } from './zip-entries';
import { safeEntryName } from '#lib/safe-entry-name.js';
import { extractZip } from './zip-extract';
import { zipStream } from './zip-writer';

export type Backup = typeof backups.$inferSelect;
export type BackupKind = Backup['kind'];

export const backupFolder = (instanceId: number) => join(backupsDir, String(instanceId));

/** Where a backup's zip lives; `file` is a plain name the panel generated. */
export const backupPath = (instanceId: number, file: string) =>
	join(backupFolder(instanceId), file);

/** The paths to leave out, from the instance's setting: one per line, `#` starts a comment. */
export function parseExcludes(text: string) {
	const paths: string[] = [];
	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const safe = safeEntryName(trimmed);
		if (!safe) throw new Error(`"${trimmed}" is not a path inside the server folder`);
		paths.push(safe);
	}
	return paths;
}

const isExcluded = (rel: string, excludes: string[]) =>
	excludes.some((path) => rel === path || rel.startsWith(`${path}/`));

// one backup or restore per instance at a time
const busy = new Map<number, 'backup' | 'restore'>();

function claim(instanceId: number, what: 'backup' | 'restore') {
	const current = busy.get(instanceId);
	if (current === 'restore') throw new Error('A restore is in progress');
	if (current === 'backup') throw new Error('A backup is already running');
	busy.set(instanceId, what);
	return () => busy.delete(instanceId);
}

export function listBackups(instanceId: number) {
	return db
		.select()
		.from(backups)
		.where(eq(backups.instanceId, instanceId))
		.orderBy(desc(backups.createdAt), desc(backups.id))
		.all();
}

export function getBackup(instanceId: number, backupId: number) {
	return db
		.select()
		.from(backups)
		.where(and(eq(backups.id, backupId), eq(backups.instanceId, instanceId)))
		.get();
}

/** How long to wait on the server while pausing saves; adjustable so tests need not wait. */
export const timing = { quietMs: 300, saveOffMs: 15_000, saveAllMs: 120_000 };

/** Whether the line is the server confirming something (it logs after "[Server thread/INFO]: "). */
const SAVE_OFF_DONE = /Automatic saving is now disabled|Saving is already turned off/;
const SAVE_ALL_DONE = /Saved the (game|world)/;

/** Reads a runner's log in order, so a line is matched once and none is dropped between waits. */
class LogWatcher {
	private pending: ReturnType<Subscription['nextBatch']> | null = null;
	private queue: ServerMessage[] = [];

	constructor(private sub: Subscription) {}

	/** One more message, or null after `ms` or when the runner closed. */
	private async next(ms: number) {
		if (!this.queue.length) {
			this.pending ??= this.sub.nextBatch(50);
			const batch = await Promise.race([
				this.pending,
				Bun.sleep(ms).then(() => 'timeout' as const)
			]);
			if (batch === 'timeout' || !batch) return batch === 'timeout' ? undefined : null;
			this.pending = null;
			this.queue.push(...batch);
		}
		return this.queue.shift();
	}

	/** Skips whatever is already logged (the replay of history), up to a quiet moment. */
	async settle(quietMs: number) {
		while (await this.next(quietMs)) continue;
	}

	/** True once a log line matching `pattern` arrives; false on timeout or when the runner ends. */
	async until(pattern: RegExp, timeoutMs: number) {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const msg = await this.next(Math.max(0, deadline - Date.now()));
			if (!msg) return false;
			if (msg.type === 'log' && pattern.test(msg.line)) return true;
		}
	}
}

/**
 * Runs `work` with the world's autosave paused and flushed to disk when the server is
 * running, so the files copied are consistent. Autosave is always switched back on.
 */
async function withWorldSaved<T>(instanceId: number, work: () => Promise<T>) {
	if (!(await isRunning(instanceId))) return work();
	const dir = instanceDir(instanceId);
	const sub = await runner.subscribe(dir, instanceId);
	if (!sub) return work();

	const log = new LogWatcher(sub);
	const command = (line: string) => runner.send(dir, instanceId, { type: 'stdin', line });
	try {
		// the replayed history can hold old confirmations; only what follows the commands counts
		await log.settle(timing.quietMs);
		await command('save-off');
		try {
			if (!(await log.until(SAVE_OFF_DONE, timing.saveOffMs)))
				throw new Error('The server did not confirm it paused saving');
			await command('save-all flush');
			if (!(await log.until(SAVE_ALL_DONE, timing.saveAllMs)))
				throw new Error('The server did not finish saving the world');
			return await work();
		} finally {
			await command('save-on');
		}
	} finally {
		sub.close();
	}
}

function stamp(date = new Date()) {
	// milliseconds included: a name must not come back after an older backup is pruned
	return date.toISOString().replace(/[:.]/g, '-');
}

/** Writes the zip and records it. The caller holds the instance's claim. */
async function writeBackup(instanceId: number, kind: BackupKind, note: string | null) {
	const inst = getInstance(instanceId);
	if (!inst) throw new Error('Instance not found');
	const root = serverDir(instanceId);
	if (!existsSync(root)) throw new Error('The instance has no server folder yet');

	const excludes = parseExcludes(inst.backupExcludes);
	const entries = listZipEntries(root, (rel) => isExcluded(rel, excludes));
	const estimate = entries.reduce(
		(sum, entry) => sum + (entry.kind === 'file' ? statSync(entry.path).size : 0),
		0
	);

	const folder = backupFolder(instanceId);
	mkdirSync(folder, { recursive: true });
	const stats = statfsSync(folder);
	// compression usually beats this, but the worst case is the files stored as they are
	if (estimate + 256 * 1024 * 1024 > stats.bavail * stats.bsize)
		throw new Error('Not enough free disk space for this backup');

	let file = `${stamp()}.zip`;
	for (let n = 1; existsSync(join(folder, file)); n++) file = `${stamp()}-${n}.zip`;
	const partial = join(folder, `${file}.partial`);

	try {
		await withWorldSaved(instanceId, () =>
			pipeline(Readable.fromWeb(zipStream(entries) as never), createWriteStream(partial))
		);
		renameSync(partial, join(folder, file));
	} catch (e) {
		rmSync(partial, { force: true });
		throw e;
	}

	return db
		.insert(backups)
		.values({ instanceId, file, size: statSync(join(folder, file)).size, kind, note })
		.returning()
		.get();
}

/** Keeps the newest `backupKeep` manual and scheduled backups; the others are never pruned. */
export function pruneBackups(instanceId: number) {
	const keep = getInstance(instanceId)?.backupKeep;
	if (keep == null) return 0;
	const prunable = db
		.select()
		.from(backups)
		.where(and(eq(backups.instanceId, instanceId), inArray(backups.kind, ['manual', 'scheduled'])))
		.orderBy(desc(backups.createdAt), desc(backups.id))
		.all()
		.slice(keep);
	for (const old of prunable) removeBackup(old);
	return prunable.length;
}

function removeBackup(row: Backup) {
	rmSync(backupPath(row.instanceId, row.file), { force: true });
	db.delete(backups).where(eq(backups.id, row.id)).run();
}

export async function createBackup(
	instanceId: number,
	options: { kind?: Exclude<BackupKind, 'before-restore'>; note?: string } = {}
) {
	const inst = getInstance(instanceId);
	if (!inst) throw new Error('Instance not found');
	if (inst.installState !== 'ready') throw new Error('Wait for the install to finish');
	const release = claim(instanceId, 'backup');
	try {
		const row = await writeBackup(instanceId, options.kind ?? 'manual', options.note ?? null);
		pruneBackups(instanceId);
		return row;
	} finally {
		release();
	}
}

export function deleteBackup(instanceId: number, backupId: number) {
	const row = getBackup(instanceId, backupId);
	if (!row) throw new Error('Backup not found');
	if (busy.get(instanceId) === 'restore') throw new Error('A restore is in progress');
	removeBackup(row);
}

/**
 * Replaces the server folder with a backup. The server must be stopped. The current state is
 * backed up first, the archive is unpacked beside the server and swapped in only once it
 * extracted cleanly, and excluded paths (logs, by default) are carried over from the old folder.
 */
export async function restoreBackup(instanceId: number, backupId: number) {
	const inst = getInstance(instanceId);
	const row = getBackup(instanceId, backupId);
	if (!inst || !row) throw new Error('Backup not found');
	const archive = backupPath(instanceId, row.file);
	if (!existsSync(archive)) throw new Error('The backup file is missing');
	if (await isRunning(instanceId)) throw new Error('Stop the server before restoring a backup');
	if (inst.installState !== 'ready') throw new Error('Wait for the install to finish');

	const release = claim(instanceId, 'restore');
	const live = serverDir(instanceId);
	const incoming = `${live}.restoring`;
	const replaced = `${live}.replaced`;
	try {
		rmSync(incoming, { recursive: true, force: true });
		rmSync(replaced, { recursive: true, force: true });
		if (existsSync(live))
			await writeBackup(instanceId, 'before-restore', `Before restoring ${row.file}`);

		await extractZip(archive, incoming);

		if (existsSync(live)) {
			for (const path of parseExcludes(inst.backupExcludes)) {
				if (!existsSync(join(live, path)) || existsSync(join(incoming, path))) continue;
				mkdirSync(dirname(join(incoming, path)), { recursive: true });
				renameSync(join(live, path), join(incoming, path));
			}
			renameSync(live, replaced);
		}
		try {
			renameSync(incoming, live);
		} catch (e) {
			if (existsSync(replaced) && !existsSync(live)) renameSync(replaced, live);
			throw e;
		}
		rmSync(replaced, { recursive: true, force: true });
	} catch (e) {
		rmSync(incoming, { recursive: true, force: true });
		throw e;
	} finally {
		release();
	}
}

export function setBackupSettings(
	instanceId: number,
	settings: { backupKeep: number | null; backupExcludes: string }
) {
	if (!getInstance(instanceId)) throw new Error('Instance not found');
	parseExcludes(settings.backupExcludes);
	db.update(instances).set(settings).where(eq(instances.id, instanceId)).run();
	pruneBackups(instanceId);
}

/** Whether a backup or restore is running for the instance right now. */
export const backupBusy = (instanceId: number) => busy.get(instanceId) ?? null;
