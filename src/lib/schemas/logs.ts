import * as v from 'valibot';

import { LOG_NAME } from '../log-files.js';
import { idSchema } from './common.js';

const logLocation = { id: idSchema, name: v.pipe(v.string(), v.regex(LOG_NAME)) };

export const readLogSchema = v.object({
	...logLocation,
	lines: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(20_000))
});

export const searchLogSchema = v.object({
	...logLocation,
	query: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
	matchCase: v.boolean()
});
