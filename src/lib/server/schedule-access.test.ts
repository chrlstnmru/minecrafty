import { beforeEach, describe, expect, it } from 'vitest';

import type { Permission } from '#lib/permissions.js';
import type { ScheduleAction } from '#lib/schemas/schedules.js';

import { makeInstance } from '#test/instance.js';
import { makeRole } from '#test/roles.js';

import * as A from './access';
import { db } from './db';
import { instances, roles, users } from './db/schema';
import * as S from './schedules';
import * as U from './user-admin';

// A task acts on the server, so managing one needs the permission that action needs by hand:
// holding `schedules` alone must not be a way into the console or the start and stop buttons.

let id: number;
let other: number;
let owner: A.Actor;

async function person(name: string, permissions: Permission[], on: number | null = null) {
	const user = await U.createAccount(name, 'a-long-password', 'user');
	A.setAssignments(user.id, on, [makeRole(name, 10, permissions)]);
	return { id: user.id, role: user.role } satisfies A.Actor;
}

const task = (action: ScheduleAction) =>
	S.saveSchedule(id, {
		name: action,
		cron: '0 4 * * *',
		action,
		command: action === 'command' ? 'say hi' : undefined,
		warnMinutes: 0,
		enabled: true
	}).id;

beforeEach(async () => {
	db.delete(instances).run();
	db.delete(users).run();
	db.delete(roles).run();
	id = makeInstance().id;
	other = makeInstance().id;
	const root = await U.createAccount('root', 'a-long-password', 'owner');
	owner = { id: root.id, role: root.role };
});

describe('allowedActions', () => {
	it('offers only the actions whose permission the user holds', async () => {
		expect(S.allowedActions(await person('planner', ['schedules']), id)).toEqual([]);
		expect(S.allowedActions(await person('console', ['schedules', 'console']), id)).toEqual([
			'command'
		]);
		expect(S.allowedActions(await person('ops', ['schedules', 'control', 'backups']), id)).toEqual([
			'start',
			'stop',
			'restart',
			'backup'
		]);
	});

	it('offers everything to the owner', () => {
		expect(S.allowedActions(owner, id)).toEqual(['start', 'stop', 'restart', 'backup', 'command']);
	});

	it('counts a role given on one server only there', async () => {
		const local = await person('local', ['schedules', 'control'], id);
		expect(S.allowedActions(local, id)).toEqual(['start', 'stop', 'restart']);
		expect(S.allowedActions(local, other)).toEqual([]);
	});
});

describe('taskRefusal', () => {
	it('refuses a new console task to someone with schedules but not console', async () => {
		const planner = await person('planner', ['schedules']);
		expect(S.taskRefusal(planner, id, { action: 'command' })).toMatch(/"Console" permission/);
		expect(S.taskRefusal(planner, id, { action: 'stop' })).toMatch(/"Start and stop" permission/);
		expect(S.taskRefusal(planner, id, { action: 'backup' })).toMatch(/"Backups" permission/);
	});

	it('allows a new task whose action the user holds', async () => {
		const ops = await person('ops', ['schedules', 'control']);
		expect(S.taskRefusal(ops, id, { action: 'restart' })).toBeNull();
	});

	it('refuses running, switching or deleting a task whose action the user lacks', async () => {
		const command = task('command');
		const ops = await person('ops', ['schedules', 'control']);
		expect(S.taskRefusal(ops, id, { scheduleId: command })).toMatch(/"Console" permission/);
		expect(S.taskRefusal(ops, id, { scheduleId: task('restart') })).toBeNull();
	});

	it('refuses turning a task into one the user lacks, and taking over one they lack', async () => {
		const ops = await person('ops', ['schedules', 'control']);
		const restart = task('restart');
		expect(S.taskRefusal(ops, id, { scheduleId: restart, action: 'command' })).toMatch(/Console/);
		expect(S.taskRefusal(ops, id, { scheduleId: task('command'), action: 'restart' })).toMatch(
			/Console/
		);
		expect(S.taskRefusal(ops, id, { scheduleId: restart, action: 'stop' })).toBeNull();
	});

	it('lets the owner do anything', () => {
		expect(S.taskRefusal(owner, id, { scheduleId: task('command'), action: 'backup' })).toBeNull();
	});

	it('reports a task that is not on this instance', async () => {
		const ops = await person('ops', ['schedules', 'control']);
		expect(() => S.taskRefusal(ops, other, { scheduleId: task('restart') })).toThrow(/not found/);
	});
});
