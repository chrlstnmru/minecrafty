import * as v from 'valibot';
import { MAX_VALUE_CHARS, PROPERTY_KEY } from '../server-properties-catalog.js';
import { idSchema } from './common.js';

export const savePropertiesSchema = v.object({
	id: idSchema,
	values: v.record(
		v.pipe(v.string(), v.regex(PROPERTY_KEY)),
		v.pipe(v.string(), v.maxLength(MAX_VALUE_CHARS))
	)
});
