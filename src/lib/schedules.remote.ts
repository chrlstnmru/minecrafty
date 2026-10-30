import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { command, query } from '$app/server';
import { idSchema } from '#lib/schemas/common.js';
import {
	scheduleRefSchema,
	scheduleSchema,
	scheduleToggleSchema,
	type ScheduleAction
} from '#lib/schemas/schedules.js';
import type { Actor } from '#lib/server/access.js';
import { requirePermission, requireUser } from '#lib/server/auth.js';
import { record } from '#lib/server/audit.js';
import { userFacing } from '#lib/server/http.js';
import * as schedules from '#lib/server/schedules.js';

/** Besides `schedules`, a task needs the permission its action uses; refuses with 403 otherwise. */
async function allowTask(
	user: Actor,
	instanceId: number,
	change: { scheduleId?: number; action?: ScheduleAction }
) {
	const reason = await userFacing(async () => schedules.taskRefusal(user, instanceId, change));
	if (reason) error(403, reason);
}

/**
 * The instance's tasks, each with the next time it fires (null when switched off or never) and
 * whether the caller may change it, plus the actions the caller may give a task.
 */
export const instanceSchedules = query(idSchema, async (instanceId) => {
	const user = requirePermission(instanceId, 'schedules');
	const actions = schedules.allowedActions(user, instanceId);
	return {
		actions,
		tasks: schedules.listSchedules(instanceId).map((task) => ({
			...task,
			next: task.enabled ? (schedules.previewCron(task.cron, 1).next[0] ?? null) : null,
			canChange: actions.includes(task.action)
		}))
	};
});

/** The next few times an expression fires, in the host's time zone, for the field's preview. */
export const cronPreview = query(v.pipe(v.string(), v.maxLength(100)), async (expression) => {
	requireUser();
	return {
		...schedules.previewCron(expression),
		timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
	};
});

export const saveSchedule = command(scheduleSchema, async ({ id, scheduleId, ...input }) => {
	const user = requirePermission(id, 'schedules');
	// a change needs the permission for what the task did and for what it will do
	await allowTask(user, id, { scheduleId, action: input.action });
	const row = await userFacing(async () => schedules.saveSchedule(id, input, scheduleId));
	record({
		action: scheduleId ? 'schedule.change' : 'schedule.add',
		summary: `${scheduleId ? 'Changed' : 'Added'} the task "${input.name}"`,
		instanceId: id
	});
	await instanceSchedules(id).refresh();
	return row;
});

export const deleteSchedule = command(scheduleRefSchema, async ({ id, scheduleId }) => {
	const user = requirePermission(id, 'schedules');
	await allowTask(user, id, { scheduleId });
	const name = schedules.getSchedule(id, scheduleId).name;
	await userFacing(async () => schedules.deleteSchedule(id, scheduleId));
	record({ action: 'schedule.delete', summary: `Deleted the task "${name}"`, instanceId: id });
	await instanceSchedules(id).refresh();
});

export const toggleSchedule = command(scheduleToggleSchema, async ({ id, scheduleId, enabled }) => {
	const user = requirePermission(id, 'schedules');
	await allowTask(user, id, { scheduleId });
	const name = schedules.getSchedule(id, scheduleId).name;
	await userFacing(async () => schedules.setScheduleEnabled(id, scheduleId, enabled));
	record({
		action: 'schedule.toggle',
		summary: `${enabled ? 'Turned on' : 'Turned off'} the task "${name}"`,
		instanceId: id
	});
	await instanceSchedules(id).refresh();
});

/** Runs a task now, outside its schedule; returns how it went. */
export const runScheduleNow = command(scheduleRefSchema, async ({ id, scheduleId }) => {
	const user = requirePermission(id, 'schedules');
	await allowTask(user, id, { scheduleId });
	const outcome = await userFacing(() => schedules.runSchedule(id, scheduleId));
	await instanceSchedules(id).refresh();
	return outcome ?? { status: 'skipped' as const, message: 'It is already running' };
});
