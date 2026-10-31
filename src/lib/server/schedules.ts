import { and, eq } from 'drizzle-orm';

import { matches, nextRun, parseCron } from '#lib/cron.js';
import { formatBytes } from '#lib/format.js';
import { registry } from '#lib/permissions.js';
import {
	SCHEDULE_ACTIONS,
	SCHEDULE_ACTION_PERMISSION,
	type ScheduleAction
} from '#lib/schemas/schedules.js';

import { can, type Actor } from './access';
import { record } from './audit';
import { createBackup } from './backups';
import { db } from './db';
import { schedules } from './db/schema';
import { getInstance, restartInstance, startInstance, stopInstance } from './instances';
import { isRunning, sendLine } from './live-server';

export type Schedule = typeof schedules.$inferSelect;

export type ScheduleInput = {
	name: string;
	cron: string;
	action: ScheduleAction;
	command?: string;
	warnMinutes: number;
	enabled: boolean;
};

export const listSchedules = (instanceId: number) =>
	db
		.select()
		.from(schedules)
		.where(eq(schedules.instanceId, instanceId))
		.orderBy(schedules.id)
		.all();

export function getSchedule(instanceId: number, scheduleId: number) {
	const row = db
		.select()
		.from(schedules)
		.where(and(eq(schedules.id, scheduleId), eq(schedules.instanceId, instanceId)))
		.get();
	if (!row) throw new Error('Scheduled task not found');
	return row;
}

/** What gets stored: a command only for the command action, a warning only before a stop or restart. */
function normalize(input: ScheduleInput) {
	const parsed = parseCron(input.cron);
	if (!parsed.ok) throw new Error(parsed.error);
	const warns = input.action === 'stop' || input.action === 'restart';
	return {
		name: input.name.trim(),
		cron: input.cron.trim(),
		action: input.action,
		// the console takes commands without the slash that chat needs
		command: input.action === 'command' ? (input.command ?? '').trim().replace(/^\/+/, '') : null,
		warnMinutes: warns ? input.warnMinutes : 0,
		enabled: input.enabled
	};
}

export function saveSchedule(instanceId: number, input: ScheduleInput, scheduleId?: number) {
	if (!getInstance(instanceId)) throw new Error('Instance not found');
	const values = normalize(input);
	if (values.action === 'command' && !values.command) throw new Error('Enter the command to send');
	if (scheduleId) {
		getSchedule(instanceId, scheduleId);
		return db.update(schedules).set(values).where(eq(schedules.id, scheduleId)).returning().get();
	}
	return db
		.insert(schedules)
		.values({ ...values, instanceId })
		.returning()
		.get();
}

/** The actions the user may give a task on this instance: each needs the permission it acts with. */
export const allowedActions = (user: Actor, instanceId: number) =>
	SCHEDULE_ACTIONS.filter((action) =>
		can(user, SCHEDULE_ACTION_PERMISSION[action], { instanceId })
	);

/**
 * Why the user may not add, change, run or remove a task, or null when they may. An existing task
 * (`scheduleId`) needs the permission for what it does, and a new or changed `action` the
 * permission for that. Holding `schedules` is checked by the caller.
 */
export function taskRefusal(
	user: Actor,
	instanceId: number,
	change: { scheduleId?: number; action?: ScheduleAction }
) {
	const actions = [
		...(change.scheduleId ? [getSchedule(instanceId, change.scheduleId).action] : []),
		...(change.action ? [change.action] : [])
	];
	for (const action of actions) {
		const needed = SCHEDULE_ACTION_PERMISSION[action];
		if (!can(user, needed, { instanceId }))
			return `A task that does this needs the "${registry[needed].label}" permission`;
	}
	return null;
}

export function deleteSchedule(instanceId: number, scheduleId: number) {
	getSchedule(instanceId, scheduleId);
	db.delete(schedules).where(eq(schedules.id, scheduleId)).run();
}

export function setScheduleEnabled(instanceId: number, scheduleId: number, enabled: boolean) {
	getSchedule(instanceId, scheduleId);
	db.update(schedules).set({ enabled }).where(eq(schedules.id, scheduleId)).run();
}

/** The next few times an expression fires, for the preview next to the field. */
export function previewCron(expression: string, count = 3, from = new Date()) {
	const parsed = parseCron(expression);
	if (!parsed.ok) return { error: parsed.error, next: [] as string[] };
	const next: string[] = [];
	let at: Date | null = from;
	for (let i = 0; i < count && at; i++) {
		at = nextRun(parsed.spec, at);
		if (at) next.push(at.toISOString());
	}
	return { error: null, next };
}

export type Outcome = { status: 'ok' | 'failed' | 'skipped'; message: string };

/** What a task can do to the server. Real by default; a test passes its own. */
export type Deps = {
	isRunning(instanceId: number): Promise<boolean>;
	start(instanceId: number): Promise<void>;
	stop(instanceId: number): Promise<void>;
	/** stops the server, waits for it to exit, and starts it again; throws if it will not stop */
	restart(instanceId: number): Promise<void>;
	/** a line typed into the server's console */
	console(instanceId: number, line: string): Promise<void>;
	backup(instanceId: number, note: string): Promise<{ size: number }>;
};

const realDeps: Deps = {
	isRunning,
	start: startInstance,
	stop: stopInstance,
	restart: restartInstance,
	console: async (id, line) => {
		await sendLine(id, line);
	},
	backup: (id, note) => createBackup(id, { kind: 'scheduled', note })
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Does what one task says, once. Never throws: the result is what the page shows. */
export async function performAction(task: Schedule, deps: Deps = realDeps): Promise<Outcome> {
	const id = task.instanceId;
	try {
		const running = await deps.isRunning(id);
		switch (task.action) {
			case 'start':
				if (running) return { status: 'skipped', message: 'Already running' };
				await deps.start(id);
				return { status: 'ok', message: 'Started' };
			case 'stop':
				if (!running) return { status: 'skipped', message: 'Already stopped' };
				await deps.stop(id);
				return {
					status: 'ok',
					message: 'Stop requested; the server saves the world and shuts down'
				};
			case 'restart':
				await deps.restart(id);
				return { status: 'ok', message: running ? 'Restarted' : 'Was stopped, so it was started' };
			case 'backup': {
				const { size } = await deps.backup(id, `Scheduled: ${task.name}`);
				return { status: 'ok', message: `Backed up (${formatBytes(size)})` };
			}
			case 'command':
				if (!running) return { status: 'skipped', message: 'The server is stopped' };
				await deps.console(id, task.command ?? '');
				return { status: 'ok', message: `Sent: ${task.command}` };
		}
	} catch (e) {
		return { status: 'failed', message: e instanceof Error ? e.message : String(e) };
	}
}

// tasks being worked on right now: a restart can take minutes, and must not start twice
const busy = new Set<number>();

/** Runs a task and records how it went. Returns the outcome, or null if it is already running. */
export async function runSchedule(instanceId: number, scheduleId: number, deps: Deps = realDeps) {
	const task = getSchedule(instanceId, scheduleId);
	if (busy.has(task.id)) return null;
	busy.add(task.id);
	try {
		const outcome = await performAction(task, deps);
		db.update(schedules)
			.set({
				lastRunAt: new Date(),
				lastStatus: outcome.status,
				lastMessage: outcome.message.slice(0, 300)
			})
			.where(eq(schedules.id, task.id))
			.run();
		record({
			action: 'schedule.run',
			summary: `Ran the task "${task.name}": ${outcome.message}`,
			instanceId
		});
		return outcome;
	} finally {
		busy.delete(task.id);
	}
}

/** The in-game message for a countdown to a stop or restart. */
export const warningText = (action: ScheduleAction, minutes: number) =>
	`say The server is ${action === 'restart' ? 'restarting' : 'stopping'} in ${plural(minutes, 'minute')}`;

let lastMinute = -1;

/**
 * Everything due at the minute `now` falls in: tasks whose expression matches run, and a stop or
 * restart that is `warnMinutes` (or one minute) away gets its in-game warning. Called once a
 * minute; a second call for the same minute does nothing, so a late timer cannot run a task twice.
 */
export async function tick(now: Date, deps: Deps = realDeps) {
	const minute = Math.floor(now.getTime() / 60_000);
	if (minute === lastMinute) return [];
	lastMinute = minute;

	const due: Promise<unknown>[] = [];
	for (const task of db.select().from(schedules).where(eq(schedules.enabled, true)).all()) {
		const parsed = parseCron(task.cron);
		if (!parsed.ok) continue;
		if (matches(parsed.spec, now)) {
			due.push(runSchedule(task.instanceId, task.id, deps).catch(() => null));
			continue;
		}
		if (task.warnMinutes > 0 && (task.action === 'stop' || task.action === 'restart')) {
			const next = nextRun(parsed.spec, now);
			const away = next ? Math.round((next.getTime() - now.getTime()) / 60_000) : 0;
			if (away === task.warnMinutes || (away === 1 && task.warnMinutes > 1))
				due.push(
					deps
						.isRunning(task.instanceId)
						.then((running) =>
							running ? deps.console(task.instanceId, warningText(task.action, away)) : undefined
						)
						.catch(() => undefined)
				);
		}
	}
	return Promise.allSettled(due);
}

/** Starts the once-a-minute clock. Does nothing if it already runs. */
let timer: ReturnType<typeof setTimeout> | null = null;
export function startScheduler() {
	if (timer) return;
	const loop = () => {
		void tick(new Date());
		// aim just after the minute turns, so "04:00" runs at 04:00 and not a moment before
		timer = setTimeout(loop, 60_000 - (Date.now() % 60_000) + 200);
	};
	timer = setTimeout(loop, 60_000 - (Date.now() % 60_000) + 200);
}

/** Forgets which minute was last handled; for tests. */
export const resetScheduler = () => {
	lastMinute = -1;
	busy.clear();
};
