import * as v from 'valibot';
import { command, query } from '$app/server';
import { idSchema } from '#lib/schemas/common.js';
import { scheduleRefSchema, scheduleSchema, scheduleToggleSchema } from '#lib/schemas/schedules.js';
import { requirePermission, requireUser } from '#lib/server/auth.js';
import { record } from '#lib/server/audit.js';
import { userFacing } from '#lib/server/http.js';
import * as schedules from '#lib/server/schedules.js';

const taskName = (instanceId: number, scheduleId: number) =>
	schedules.listSchedules(instanceId).find((t) => t.id === scheduleId)?.name ?? 'a task';

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
	record({
		action: scheduleId ? 'schedule.change' : 'schedule.add',
		summary: `${scheduleId ? 'Changed' : 'Added'} the task "${input.name}"`,
		instanceId: id
	});
	await instanceSchedules(id).refresh();
	return row;
});

export const deleteSchedule = command(scheduleRefSchema, async ({ id, scheduleId }) => {
	requirePermission(id, 'schedules');
	const name = taskName(id, scheduleId);
	await userFacing(async () => schedules.deleteSchedule(id, scheduleId));
	record({ action: 'schedule.delete', summary: `Deleted the task "${name}"`, instanceId: id });
	await instanceSchedules(id).refresh();
});

export const toggleSchedule = command(scheduleToggleSchema, async ({ id, scheduleId, enabled }) => {
	requirePermission(id, 'schedules');
	await userFacing(async () => schedules.setScheduleEnabled(id, scheduleId, enabled));
	record({
		action: 'schedule.toggle',
		summary: `${enabled ? 'Turned on' : 'Turned off'} the task "${taskName(id, scheduleId)}"`,
		instanceId: id
	});
	await instanceSchedules(id).refresh();
});

/** Runs a task now, outside its schedule; returns how it went. */
export const runScheduleNow = command(scheduleRefSchema, async ({ id, scheduleId }) => {
	requirePermission(id, 'schedules');
	const outcome = await userFacing(() => schedules.runSchedule(id, scheduleId));
	await instanceSchedules(id).refresh();
	return outcome ?? { status: 'skipped' as const, message: 'It is already running' };
});
