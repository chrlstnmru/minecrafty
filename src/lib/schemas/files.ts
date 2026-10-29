import * as v from 'valibot';
import { idSchema } from './common.js';

/** A path relative to the instance's server folder; '' is the folder itself. */
export const filePathSchema = v.pipe(v.string(), v.maxLength(1024));
export const fileNameSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1, 'Enter a name'),
	v.maxLength(255)
);

export const uploadFilesSchema = v.object({
	id: idSchema,
	path: filePathSchema,
	files: v.pipe(
		v.array(v.custom<File>((f) => f instanceof Blob, 'Choose at least one file')),
		v.minLength(1, 'Choose at least one file')
	)
});
