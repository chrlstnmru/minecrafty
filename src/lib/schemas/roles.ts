import * as v from 'valibot';
import { PERMISSIONS, SETTING_FIELDS } from '#lib/permissions.js';
import { idSchema } from './common.js';

export const roleInputSchema = v.object({
	name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Give the role a name'), v.maxLength(40)),
	description: v.pipe(v.string(), v.maxLength(200)),
	rules: v.object({
		allow: v.array(v.picklist(PERMISSIONS)),
		deny: v.array(v.picklist(PERMISSIONS)),
		lockedProperties: v.array(v.pipe(v.string(), v.regex(/^[A-Za-z0-9._-]{1,100}$/))),
		lockedSettings: v.array(v.picklist(SETTING_FIELDS))
	})
});

export const roleUpdateSchema = v.object({ id: idSchema, ...roleInputSchema.entries });
