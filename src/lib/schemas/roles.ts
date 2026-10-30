import * as v from 'valibot';
import { MAX_RANK, PERMISSIONS } from '#lib/permissions.js';
import { idSchema } from './common.js';

export const roleInputSchema = v.object({
	name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Give the role a name'), v.maxLength(40)),
	description: v.pipe(v.string(), v.maxLength(200)),
	rank: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_RANK)),
	rules: v.object({
		allow: v.array(v.picklist(PERMISSIONS)),
		deny: v.array(v.picklist(PERMISSIONS))
	})
});

export const roleUpdateSchema = v.object({ id: idSchema, ...roleInputSchema.entries });
