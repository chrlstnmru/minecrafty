import { eq } from 'drizzle-orm';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { currentActor, record } from './audit';
import { instanceDir } from './config';
import { db } from './db';
import { instances } from './db/schema';
import { isRunning } from './live-server';

// What an instance is busy with besides running, and every change to its install state: one
// install, update, backup, restore or write at a time, its progress, how the last update ended, and
// whether an action may happen now.

type Instance = typeof instances.$inferSelect;
type NewInstance = typeof instances.$inferInsert;

/** `write` adds files to a server over time: a mod install or update, a resource pack, an upload. */
export type JobKind = 'install' | 'update' | 'backup' | 'restore' | 'write';
export type Action = JobKind | 'start' | 'delete';

/** `bytes` says done and total are byte counts, which the page shows as sizes, not as a count of items. */
export type Progress = { label: string; done: number; total: number; bytes?: boolean };
export type Report = (label: string, counts?: Omit<Progress, 'label'>) => void;

/** How the last update of an instance ended; lost on restart, like the progress. */
type Outcome = {
	ok: boolean;
	message: string;
	/** extra lines worth showing, such as the files an update left alone */
	details?: string[];
	at: number;
};

export type InstallTools = { progress: Report };

export type UpdateTools = {
	progress: Report;
	/** an empty folder beside the server to build the new files in; removed when the job ends */
	staging(): string;
	/**
	 * Call right before the first change to the live server folder. A failure after it leaves the
	 * instance failed, because its files may be half replaced; before it, the server is untouched.
	 */
	commit(): void;
};

export type UpdateResult = {
	/** the instance columns the update changes */
	set: Partial<NewInstance>;
	message: string;
	/** extra lines worth showing, such as the files an update left alone */
	details?: string[];
};

type Held = { job: JobKind; progress: Progress | null };

const held = new Map<number, Held>();
const outcomes = new Map<number, Outcome>();
// apart from `held` because a backup and a start may overlap, and `held` has room for one
const starting = new Set<number>();

/** A start was refused because another start of the instance has not finished. */
export class AlreadyStartingError extends Error {
	constructor() {
		super('The server is already starting');
	}
}

const BUSY: Record<JobKind, string> = {
	install: 'Wait for the install to finish',
	update: 'An update is in progress',
	backup: 'A backup is already running',
	restore: 'A restore is in progress',
	write: 'Files are being added to this server'
};

type Rule = {
	/** the jobs that refuse the action while they hold the instance */
	blockedBy: readonly JobKind[];
	/** a start in progress refuses the action too */
	notStarting?: true;
	/** the install must have finished: not installing, not failed */
	ready?: true;
	/** the server must be stopped; the words after "Stop the server before" */
	stopped?: string;
};

const ALL: readonly JobKind[] = ['install', 'update', 'backup', 'restore', 'write'];

const RULES: Record<Action, Rule> = {
	install: { blockedBy: ALL, notStarting: true },
	update: { blockedBy: ALL, notStarting: true, ready: true, stopped: 'updating it' },
	backup: { blockedBy: ALL, ready: true },
	// a failed update leaves a server that may not start; restoring a backup is how it recovers
	restore: { blockedBy: ALL, notStarting: true, stopped: 'restoring a backup' },
	// a backup saves the world through the running server, so it may start during one
	start: { blockedBy: ['install', 'update', 'restore'], ready: true },
	delete: { blockedBy: ALL, notStarting: true, stopped: 'deleting it' },
	// a running server only reads new files at its next start, so neither a start nor a run stops this
	write: { blockedBy: ALL }
};

/**
 * Whether the server was installed successfully at least once: instance.json is only written when
 * an install or update finishes. A failure after that is a failed update, and the folder holds a
 * world that must not be thrown away.
 */
export const wasInstalled = (id: number) => existsSync(join(instanceDir(id), 'instance.json'));

/** Records what the instance runs in instance.json, for anything that reads the folder without the database. */
function writeInstanceMeta(row: Instance) {
	writeFileSync(
		join(instanceDir(row.id), 'instance.json'),
		JSON.stringify(
			{
				loader: row.loader,
				mcVersion: row.mcVersion,
				ramMaxMb: row.ramMaxMb,
				jvmArgs: row.jvmArgs
			},
			null,
			2
		)
	);
}

/** The job holding the instance, its progress, and how its last update ended. */
export function jobState(id: number) {
	const now = held.get(id);
	return {
		job: now?.job ?? null,
		progress: now?.progress ?? null,
		outcome: outcomes.get(id) ?? null
	};
}

/**
 * Throws while a restore swaps the server folder or an install or update is writing to it, when a
 * change made now would be lost or would land in a half-built server. A backup does not count.
 */
export function assertWritable(id: number) {
	const job = held.get(id)?.job;
	if (job === 'restore') throw new Error(BUSY.restore);
	const row = db
		.select({ state: instances.installState })
		.from(instances)
		.where(eq(instances.id, id))
		.get();
	if (job === 'install' || job === 'update' || row?.state === 'installing')
		throw new Error('Wait for the install or update to finish');
}

/** The checks that need no await; `self` is a job that already holds the instance for this action. */
function checkNow(id: number, action: Action, self?: Held): Instance {
	const rule = RULES[action];
	const inst = db.select().from(instances).where(eq(instances.id, id)).get();
	if (!inst) throw new Error('Instance not found');
	const job = held.get(id);
	if (job && job !== self && rule.blockedBy.includes(job.job)) throw new Error(BUSY[job.job]);
	if (rule.notStarting && starting.has(id)) throw new AlreadyStartingError();
	if (action !== 'install' && inst.installState === 'installing') throw new Error(BUSY.install);
	if (rule.ready && inst.installState === 'failed')
		throw new Error(`The install failed: ${inst.installMessage ?? 'unknown error'}`);
	if (action === 'restore' && inst.installState === 'failed' && !wasInstalled(id))
		throw new Error('The install failed, so there is nothing to restore into');
	return inst;
}

async function checkStopped(id: number, action: Action) {
	const phrase = RULES[action].stopped;
	if (phrase && (await isRunning(id))) throw new Error(`Stop the server before ${phrase}`);
}

/**
 * Checks whether `action` may happen to the instance now, without taking it, and returns its row.
 * Throws "Instance not found", the message of the job holding it, or the first check that fails.
 */
export async function check(id: number, action: Action): Promise<Instance> {
	const inst = checkNow(id, action);
	await checkStopped(id, action);
	return inst;
}

/**
 * Takes the instance for a job, then checks the action. The claim happens before anything is
 * awaited, so two jobs started together cannot both pass the checks. Gives the instance back if
 * a check fails.
 */
async function take(id: number, kind: JobKind) {
	const current = held.get(id);
	if (current) {
		// a write used to overlap a backup, and is often one click of many, so it says what to do next
		const retry = kind === 'write' ? '. Try again when that finishes.' : '';
		throw new Error(BUSY[current.job] + retry);
	}
	const mine: Held = { job: kind, progress: null };
	held.set(id, mine);
	const release = () => {
		if (held.get(id) === mine) held.delete(id);
	};
	try {
		const inst = checkNow(id, kind, mine);
		await checkStopped(id, kind);
		return { inst, mine, release };
	} catch (e) {
		release();
		throw e;
	}
}

/**
 * Holds the instance for one start, from the checks until `work` settles, so a second start, an
 * install, update, restore or delete is refused until then. The claim happens before anything is
 * awaited. A start can take minutes when it has to download Java. A backup is not refused.
 */
export async function holdStart<T>(id: number, work: (inst: Instance) => Promise<T>): Promise<T> {
	if (starting.has(id)) throw new AlreadyStartingError();
	starting.add(id);
	try {
		return await work(await check(id, 'start'));
	} finally {
		starting.delete(id);
	}
}

const reporter =
	(mine: Held): Report =>
	(label, counts) => {
		mine.progress = { label, done: 0, total: 1, ...counts };
	};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function markInstalling(id: number) {
	return db
		.update(instances)
		.set({ installState: 'installing', installMessage: null })
		.where(eq(instances.id, id))
		.returning()
		.get();
}

function markFailed(id: number, message: string) {
	db.update(instances)
		.set({ installState: 'failed', installMessage: message.slice(0, 500) })
		.where(eq(instances.id, id))
		.run();
}

/**
 * Starts a background install or update of the instance's server files. Resolves once the instance
 * is taken, has passed the checks for `kind` and shows as installing; `finished` settles when the
 * job is over, whichever way it went, and never rejects.
 *
 * An install that fails leaves the instance failed. An update that fails leaves it failed only
 * after `commit()`, and ready before it. A finished update applies `set`, records its outcome, and
 * writes `${audit}.update.done` (or `.failed`) to the audit log, credited to whoever started it.
 */
export function start(
	id: number,
	kind: 'install',
	work: (tools: InstallTools) => Promise<void>,
	opts?: { what?: string }
): Promise<{ row: Instance; finished: Promise<void> }>;
export function start(
	id: number,
	kind: 'update',
	work: (tools: UpdateTools) => Promise<UpdateResult>,
	opts: { audit: 'loader' | 'modpack' }
): Promise<{ row: Instance; finished: Promise<void> }>;
export async function start(
	id: number,
	kind: 'install' | 'update',
	work: (tools: UpdateTools) => Promise<UpdateResult | void>,
	opts: { what?: string; audit?: 'loader' | 'modpack' } = {}
) {
	const actor = currentActor();
	const { mine, release } = await take(id, kind);
	const row = markInstalling(id);
	if (kind === 'update') outcomes.delete(id);
	const progress = reporter(mine);
	progress('Starting');

	const finished = (async () => {
		const staging = join(instanceDir(id), 'server.updating');
		let made = false;
		let committed = kind === 'install';
		try {
			const result = await work({
				progress,
				staging: () => {
					if (!made) {
						rmSync(staging, { recursive: true, force: true });
						mkdirSync(staging, { recursive: true });
						made = true;
					}
					return staging;
				},
				commit: () => {
					committed = true;
				}
			});
			const done = db
				.update(instances)
				.set({ ...result?.set, installState: 'ready', installMessage: null })
				.where(eq(instances.id, id))
				.returning()
				.get();
			writeInstanceMeta(done);
			if (result && opts.audit) {
				outcomes.set(id, {
					ok: true,
					message: result.message,
					details: result.details,
					at: Date.now()
				});
				record(
					{ action: `${opts.audit}.update.done`, summary: result.message, instanceId: id },
					actor
				);
			}
		} catch (e) {
			const message = errorText(e);
			if (kind === 'install') {
				console.error(
					`[install] ${opts.what ?? 'install'} of "${row.name}" (#${id}) failed: ${message}`
				);
				markFailed(id, message);
			} else {
				console.error(`[${opts.audit}] update of #${id} failed: ${message}`);
				if (committed) markFailed(id, message);
				else
					db.update(instances)
						.set({ installState: 'ready', installMessage: null })
						.where(eq(instances.id, id))
						.run();
				const failure = committed ? `The update stopped part way: ${message}` : message;
				outcomes.set(id, { ok: false, message: failure, at: Date.now() });
				record(
					{
						action: `${opts.audit}.update.failed`,
						summary: `Update failed: ${failure}`,
						instanceId: id
					},
					actor
				);
			}
		} finally {
			if (made) rmSync(staging, { recursive: true, force: true });
			release();
		}
	})();

	return { row, finished };
}

/**
 * Takes the instance for a backup, restore or write, checks it, runs `work` and gives the instance
 * back, resolving or rejecting as `work` does. A restore that succeeds on a failed instance makes
 * it ready again, since its server folder is now the backup's.
 */
export async function run<T>(
	id: number,
	kind: 'backup' | 'restore' | 'write',
	work: (inst: Instance, tools: { progress: Report }) => Promise<T>
): Promise<T> {
	const { inst, mine, release } = await take(id, kind);
	try {
		const value = await work(inst, { progress: reporter(mine) });
		if (kind === 'restore' && inst.installState === 'failed')
			db.update(instances)
				.set({ installState: 'ready', installMessage: null })
				.where(eq(instances.id, id))
				.run();
		return value;
	} finally {
		release();
	}
}

/** An install or update that was running when the panel stopped cannot continue; marks it failed. */
export function recoverInterruptedJobs() {
	db.update(instances)
		.set({ installState: 'failed', installMessage: 'Interrupted by a panel restart' })
		.where(eq(instances.installState, 'installing'))
		.run();
}
