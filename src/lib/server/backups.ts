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
import { busyWith, claim } from './operations';
import { getInstance, serverDir, wasInstalled } from './instances';
import { isRunning, withWorldSaved } from './live-server';
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

function stamp(date = new Date()) {
	// milliseconds included: a name must not come back after an older backup is pruned
	return date.toISOString().replace(/[:.]/g, '-');
}

/** Writes the zip and records it. The caller holds the instance's claim. */
export async function writeBackup(instanceId: number, kind: BackupKind, note: string | null) {
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
	options: { kind?: Exclude<BackupKind, 'before-restore' | 'before-update'>; note?: string } = {}
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
	if (busyWith(instanceId) === 'restore') throw new Error('A restore is in progress');
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
	if (inst.installState === 'installing') throw new Error('Wait for the install to finish');
	// a failed update leaves a server that may not start; restoring a backup is how it recovers
	if (inst.installState === 'failed' && !wasInstalled(instanceId))
		throw new Error('The install failed, so there is nothing to restore into');

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
		if (inst.installState === 'failed')
			db.update(instances)
				.set({ installState: 'ready', installMessage: null })
				.where(eq(instances.id, instanceId))
				.run();
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

/** Whether a backup, restore or update is running for the instance right now. */
export const backupBusy = busyWith;
