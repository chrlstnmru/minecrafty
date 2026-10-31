import * as v from 'valibot';

import { idSchema } from './common.js';

export const packOptionsSchema = v.object({
	id: idSchema,
	required: v.optional(v.boolean(), false),
	prompt: v.pipe(v.string(), v.maxLength(200))
});
