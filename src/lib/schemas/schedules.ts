import * as v from 'valibot';
import { parseCron } from '../cron.js';
import { idSchema } from './common.js';

export const SCHEDULE_ACTIONS = ['start', 'stop', 'restart', 'backup', 'command'] as const;
export type ScheduleAction = (typeof SCHEDULE_ACTIONS)[number];

/** A cron expression, checked with the same parser the scheduler uses. */
export const cronSchema = v.pipe(
	v.string(),
	v.trim(),
	v.maxLength(100, 'Too long'),
	v.rawCheck(({ dataset, addIssue }) => {
		if (!dataset.typed) return;
		const result = parseCron(dataset.value);
		if (!result.ok) addIssue({ message: result.error });
	})
);

export const scheduleSchema = v.pipe(
	v.object({
		id: idSchema,
		// set when an existing task is being changed
		scheduleId: v.optional(idSchema),
		name: v.pipe(
			v.string(),
			v.trim(),
			v.minLength(1, 'Give it a name'),
			v.maxLength(60, 'At most 60 characters')
		),
		cron: cronSchema,
		action: v.picklist(SCHEDULE_ACTIONS),
		command: v.optional(
			v.pipe(
				v.string(),
				v.trim(),
				v.maxLength(500, 'At most 500 characters'),
				// one line: a console command is a single line of input
				v.check(
					(value) =>
						![...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127),
					'Use a single line'
				)
			)
		),
		warnMinutes: v.pipe(
			v.number(),
			v.integer(),
			v.minValue(0),
			v.maxValue(60, 'At most 60 minutes')
		),
		enabled: v.boolean()
	}),
	v.forward(
		v.partialCheck(
			[['action'], ['command']],
			(input) => input.action !== 'command' || !!input.command,
			'Enter the command to send'
		),
		['command']
	)
);

export const scheduleRefSchema = v.object({ id: idSchema, scheduleId: idSchema });
export const scheduleToggleSchema = v.object({
	id: idSchema,
	scheduleId: idSchema,
	enabled: v.boolean()
});
