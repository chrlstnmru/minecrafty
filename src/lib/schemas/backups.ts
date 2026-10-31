import * as v from 'valibot';

import { safeEntryName } from '../safe-entry-name.js';
import { idSchema } from './common.js';

/** Paths left out of a backup: one per line, blank lines and `#` comments allowed. */
const excludes = v.pipe(
	v.string(),
	v.maxLength(2000, 'Too long'),
	v.check(
		(text) =>
			text
				.split('\n')
				.every((line) => !line.trim() || line.trim().startsWith('#') || safeEntryName(line.trim())),
		'Use paths inside the server folder, one per line, without ".." or a leading "/"'
	)
);

export const backupSettingsSchema = v.object({
	id: idSchema,
	// '' keeps every backup
	keep: v.pipe(
		v.string(),
		v.regex(/^\d{0,3}$/, 'Use a whole number'),
		v.check(
			(value) => value === '' || (Number(value) >= 1 && Number(value) <= 500),
			'Use 1 to 500'
		),
		v.transform((value) => (value === '' ? null : Number(value)))
	),
	excludes
});

export const backupArgsSchema = v.object({ id: idSchema, backupId: idSchema });
export const newBackupSchema = v.object({
	id: idSchema,
	note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)))
});
