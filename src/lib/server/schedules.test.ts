import { eq } from 'drizzle-orm';
import * as v from 'valibot';
import { beforeEach, describe, expect, it } from 'vitest';

import { scheduleSchema } from '#lib/schemas/schedules.js';
import { makeInstance } from '#test/instance.js';

import { db } from './db';
import { schedules } from './db/schema';
import * as S from './schedules';

// The server is a fake: tests decide whether it runs, and see what the scheduler did to it.
function fakeServer(running = false) {
	const log: string[] = [];
	const state = { running, stubborn: false, failWith: null as string | null };
	const deps: S.Deps = {
		isRunning: async () => state.running,
		start: async () => {
			if (state.failWith) throw new Error(state.failWith);
			log.push('start');
			state.running = true;
		},
		stop: async () => {
			log.push('stop');
			state.running = false;
		},
		restart: async () => {
			if (state.running) {
				log.push('stop');
				if (state.stubborn) throw new Error('The server did not stop within three minutes');
			}
			log.push('start');
			state.running = true;
		},
		console: async (_id, line) => void log.push(`console: ${line}`),
		backup: async (_id, note) => {
			if (state.failWith) throw new Error(state.failWith);
			log.push(`backup: ${note}`);
			return { size: 2048 };
		}
	};
	return { deps, log, state };
}

let id: number;
const base: S.ScheduleInput = {
	name: 'Nightly',
	cron: '0 4 * * *',
	action: 'restart',
	warnMinutes: 0,
	enabled: true
};
const add = (input: Partial<S.ScheduleInput> = {}) => S.saveSchedule(id, { ...base, ...input });
const at = (h: number, m: number, d = 30) => new Date(2026, 9, d, h, m, 5);
const row = (scheduleId: number) =>
	db.select().from(schedules).where(eq(schedules.id, scheduleId)).get()!;

beforeEach(() => {
	// the scheduler looks at every instance, so tasks from other tests must not be left around
	db.delete(schedules).run();
	id = makeInstance().id;
	S.resetScheduler();
});

describe('saving', () => {
	it('stores a task and lists it', () => {
		const task = add({ name: '  Backup  ', action: 'backup', cron: '0 3 * * *' });
		expect(S.listSchedules(id)).toEqual([task]);
		expect(task).toMatchObject({
			name: 'Backup',
			action: 'backup',
			enabled: true,
			lastRunAt: null
		});
	});

	it('keeps a command only for the command action, without a leading slash', () => {
		expect(add({ action: 'command', command: '/say hello' }).command).toBe('say hello');
		expect(add({ action: 'backup', command: 'say hi' }).command).toBeNull();
		expect(() => add({ action: 'command', command: '  ' })).toThrow(/Enter the command/);
	});

	it('keeps a warning only before a stop or restart', () => {
		expect(add({ action: 'restart', warnMinutes: 5 }).warnMinutes).toBe(5);
		expect(add({ action: 'stop', warnMinutes: 5 }).warnMinutes).toBe(5);
		expect(add({ action: 'backup', warnMinutes: 5 }).warnMinutes).toBe(0);
		expect(add({ action: 'start', warnMinutes: 5 }).warnMinutes).toBe(0);
	});

	it('refuses an expression it cannot read', () => {
		expect(() => add({ cron: '99 * * * *' })).toThrow(/outside 0-59/);
	});

	it('changes a task, and refuses to touch another instance', () => {
		const task = add();
		const changed = S.saveSchedule(id, { ...base, name: 'Renamed', cron: '0 5 * * *' }, task.id);
		expect(changed).toMatchObject({ id: task.id, name: 'Renamed', cron: '0 5 * * *' });
		const other = makeInstance().id;
		expect(() => S.saveSchedule(other, base, task.id)).toThrow(/not found/);
		expect(() => S.deleteSchedule(other, task.id)).toThrow(/not found/);
		expect(() => S.setScheduleEnabled(other, task.id, false)).toThrow(/not found/);
	});

	it('deletes and switches off', () => {
		const task = add();
		S.setScheduleEnabled(id, task.id, false);
		expect(row(task.id).enabled).toBe(false);
		S.deleteSchedule(id, task.id);
		expect(S.listSchedules(id)).toEqual([]);
	});

	it('goes when the instance does', () => {
		add();
		db.delete(schedules).where(eq(schedules.instanceId, id)).run();
		expect(S.listSchedules(id)).toEqual([]);
	});
});

describe('the actions', () => {
	it('start: starts a stopped server, leaves a running one alone', async () => {
		const stopped = fakeServer(false);
		const task = add({ action: 'start' });
		expect(await S.runSchedule(id, task.id, stopped.deps)).toMatchObject({ status: 'ok' });
		expect(stopped.log).toEqual(['start']);
		const running = fakeServer(true);
		expect(await S.runSchedule(id, task.id, running.deps)).toMatchObject({ status: 'skipped' });
		expect(running.log).toEqual([]);
	});

	it('stop: asks a running server to stop, skips a stopped one', async () => {
		const task = add({ action: 'stop' });
		const running = fakeServer(true);
		expect(await S.runSchedule(id, task.id, running.deps)).toMatchObject({ status: 'ok' });
		expect(running.log).toEqual(['stop']);
		expect(await S.runSchedule(id, task.id, fakeServer(false).deps)).toMatchObject({
			status: 'skipped'
		});
	});

	it('restart: stops, waits until it is gone, then starts', async () => {
		const { deps, log } = fakeServer(true);
		const task = add({ action: 'restart' });
		expect(await S.runSchedule(id, task.id, deps)).toMatchObject({
			status: 'ok',
			message: 'Restarted'
		});
		expect(log).toEqual(['stop', 'start']);
	});

	it('restart: starts a server that was stopped', async () => {
		const { deps, log } = fakeServer(false);
		const task = add({ action: 'restart' });
		expect((await S.runSchedule(id, task.id, deps))?.message).toMatch(/was stopped/i);
		expect(log).toEqual(['start']);
	});

	it('restart: gives up, and does not start a second copy, when the server will not stop', async () => {
		const { deps, log, state } = fakeServer(true);
		state.stubborn = true;
		const task = add({ action: 'restart' });
		expect(await S.runSchedule(id, task.id, deps)).toMatchObject({ status: 'failed' });
		expect(log).toEqual(['stop']);
	});

	it('backup: makes a scheduled backup named after the task', async () => {
		const { deps, log } = fakeServer(true);
		const task = add({ action: 'backup', name: 'Nightly' });
		expect(await S.runSchedule(id, task.id, deps)).toMatchObject({
			status: 'ok',
			message: 'Backed up (2.0 KB)'
		});
		expect(log).toEqual(['backup: Scheduled: Nightly']);
	});

	it('command: types it into the console of a running server, skips a stopped one', async () => {
		const task = add({ action: 'command', command: 'say hello' });
		const running = fakeServer(true);
		await S.runSchedule(id, task.id, running.deps);
		expect(running.log).toEqual(['console: say hello']);
		expect(await S.runSchedule(id, task.id, fakeServer(false).deps)).toMatchObject({
			status: 'skipped'
		});
	});

	it('reports a failure instead of throwing', async () => {
		const { deps, state } = fakeServer(false);
		state.failWith = 'No Java';
		const task = add({ action: 'start' });
		expect(await S.runSchedule(id, task.id, deps)).toEqual({
			status: 'failed',
			message: 'No Java'
		});
	});

	it('records when it ran and how it went', async () => {
		const task = add({ action: 'start' });
		await S.runSchedule(id, task.id, fakeServer(false).deps);
		expect(row(task.id)).toMatchObject({ lastStatus: 'ok', lastMessage: 'Started' });
		expect(row(task.id).lastRunAt).toBeInstanceOf(Date);
	});

	it('does not run a task twice at once', async () => {
		const server = fakeServer(true);
		const task = add({ action: 'restart' });
		const first = S.runSchedule(id, task.id, server.deps);
		expect(await S.runSchedule(id, task.id, server.deps)).toBeNull();
		await first;
		expect(server.log).toEqual(['stop', 'start']);
	});
});

describe('tick', () => {
	it('runs the tasks whose time it is, and only those', async () => {
		const server = fakeServer(false);
		add({ action: 'start', cron: '0 4 * * *' });
		add({ action: 'backup', cron: '0 5 * * *' });
		await S.tick(at(4, 0), server.deps);
		expect(server.log).toEqual(['start']);
	});

	it('skips tasks that are switched off', async () => {
		const server = fakeServer(false);
		add({ action: 'start', cron: '0 4 * * *', enabled: false });
		await S.tick(at(4, 0), server.deps);
		expect(server.log).toEqual([]);
	});

	it('handles a minute once, however many times the clock calls', async () => {
		const server = fakeServer(false);
		add({ action: 'backup', cron: '0 4 * * *' });
		await S.tick(at(4, 0), server.deps);
		await S.tick(new Date(2026, 9, 30, 4, 0, 40), server.deps);
		expect(server.log).toEqual(['backup: Scheduled: Nightly']);
		await S.tick(at(4, 1), server.deps);
		expect(server.log).toHaveLength(1);
		// the same time the next day is a different minute and runs
		await S.tick(at(4, 0, 31), server.deps);
		expect(server.log).toHaveLength(2);
	});

	it('runs an every-minute task each minute', async () => {
		const server = fakeServer(true);
		add({ action: 'command', command: 'save-all', cron: '* * * * *' });
		await S.tick(at(4, 0), server.deps);
		await S.tick(at(4, 1), server.deps);
		expect(server.log).toEqual(['console: save-all', 'console: save-all']);
	});

	it('survives a task with an unreadable expression', async () => {
		const server = fakeServer(false);
		const bad = add();
		db.update(schedules).set({ cron: 'nonsense' }).where(eq(schedules.id, bad.id)).run();
		add({ action: 'start', cron: '0 4 * * *' });
		await S.tick(at(4, 0), server.deps);
		expect(server.log).toEqual(['start']);
	});
});

describe('warnings before a restart or stop', () => {
	it('warns the set number of minutes ahead, and again one minute ahead', async () => {
		const server = fakeServer(true);
		add({ action: 'restart', cron: '0 4 * * *', warnMinutes: 5 });
		await S.tick(at(3, 54), server.deps);
		expect(server.log).toEqual([]);
		await S.tick(at(3, 55), server.deps);
		await S.tick(at(3, 56), server.deps);
		await S.tick(at(3, 59), server.deps);
		expect(server.log).toEqual([
			'console: say The server is restarting in 5 minutes',
			'console: say The server is restarting in 1 minute'
		]);
	});

	it('says "stopping" before a stop, and warns once for a one-minute warning', async () => {
		const server = fakeServer(true);
		add({ action: 'stop', cron: '0 4 * * *', warnMinutes: 1 });
		await S.tick(at(3, 59), server.deps);
		expect(server.log).toEqual(['console: say The server is stopping in 1 minute']);
	});

	it('says nothing to a server that is not running', async () => {
		const server = fakeServer(false);
		add({ action: 'restart', cron: '0 4 * * *', warnMinutes: 5 });
		await S.tick(at(3, 55), server.deps);
		expect(server.log).toEqual([]);
	});

	it('gives no warning for tasks that do not stop the server', async () => {
		const server = fakeServer(true);
		add({ action: 'backup', cron: '0 4 * * *' });
		await S.tick(at(3, 55), server.deps);
		expect(server.log).toEqual([]);
	});

	it('warns before the next run even across midnight', async () => {
		const server = fakeServer(true);
		add({ action: 'restart', cron: '0 0 * * *', warnMinutes: 10 });
		await S.tick(new Date(2026, 9, 30, 23, 50, 3), server.deps);
		expect(server.log).toEqual(['console: say The server is restarting in 10 minutes']);
	});
});

describe('previewCron', () => {
	it('lists the next times, soonest first', () => {
		const { next, error } = S.previewCron('0 4 * * *', 3, new Date(2026, 9, 30, 12, 0));
		expect(error).toBeNull();
		expect(next.map((t) => new Date(t).getDate())).toEqual([31, 1, 2]);
	});

	it('explains a mistake instead of listing times', () => {
		expect(S.previewCron('nope', 3)).toMatchObject({
			error: expect.stringMatching(/five fields/),
			next: []
		});
	});
});

describe('the schedule schema', () => {
	const ok = (input: Record<string, unknown>) =>
		v.safeParse(scheduleSchema, {
			id: id,
			name: 'x',
			cron: '0 4 * * *',
			action: 'backup',
			warnMinutes: 0,
			enabled: true,
			...input
		});

	it('accepts a plain task', () => {
		expect(ok({}).success).toBe(true);
	});

	it('needs a command for the command action, on one line', () => {
		expect(ok({ action: 'command' }).success).toBe(false);
		expect(ok({ action: 'command', command: 'say hi' }).success).toBe(true);
		expect(ok({ action: 'command', command: 'say hi\nstop' }).success).toBe(false);
	});

	it('refuses a bad expression with the reason, and a missing name or too long a warning', () => {
		const bad = ok({ cron: '61 * * * *' });
		expect(bad.success).toBe(false);
		expect(JSON.stringify(bad.issues)).toContain('outside 0-59');
		expect(ok({ name: '  ' }).success).toBe(false);
		expect(ok({ action: 'restart', warnMinutes: 61 }).success).toBe(false);
		expect(ok({ warnMinutes: -1 }).success).toBe(false);
		expect(ok({ action: 'reboot' }).success).toBe(false);
	});
});
