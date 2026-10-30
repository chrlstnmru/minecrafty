import * as v from 'valibot';
import { command, query } from '$app/server';
import { idSchema } from '#lib/schemas/common.js';
import { scheduleRefSchema, scheduleSchema, scheduleToggleSchema } from '#lib/schemas/schedules.js';
import { requirePermission, requireUser } from '#lib/server/auth.js';
import { userFacing } from '#lib/server/http.js';
import * as schedules from '#lib/server/schedules.js';

/** The instance's tasks, each with the next time it fires (null when switched off or never). */
export const instanceSchedules = query(idSchema, async (instanceId) => {
	requirePermission(instanceId, 'schedules');
	return schedules.listSchedules(instanceId).map((task) => ({
		...task,
		next: task.enabled ? (schedules.previewCron(task.cron, 1).next[0] ?? null) : null
	}));
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
	requirePermission(id, 'schedules');
	const row = await userFacing(async () => schedules.saveSchedule(id, input, scheduleId));
	await instanceSchedules(id).refresh();
	return row;
});

export const deleteSchedule = command(scheduleRefSchema, async ({ id, scheduleId }) => {
	requirePermission(id, 'schedules');
	await userFacing(async () => schedules.deleteSchedule(id, scheduleId));
	await instanceSchedules(id).refresh();
});

export const toggleSchedule = command(scheduleToggleSchema, async ({ id, scheduleId, enabled }) => {
	requirePermission(id, 'schedules');
	await userFacing(async () => schedules.setScheduleEnabled(id, scheduleId, enabled));
	await instanceSchedules(id).refresh();
});

/** Runs a task now, outside its schedule; returns how it went. */
export const runScheduleNow = command(scheduleRefSchema, async ({ id, scheduleId }) => {
	requirePermission(id, 'schedules');
	const outcome = await userFacing(() => schedules.runSchedule(id, scheduleId));
	await instanceSchedules(id).refresh();
	return outcome ?? { status: 'skipped' as const, message: 'It is already running' };
});
