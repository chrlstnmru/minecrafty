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

// One request carries a batch of files, each with its path inside what was dropped. (A command
// can carry File objects; a remote form cannot be filled with them from code.)
export const uploadBatchSchema = v.object({
	id: idSchema,
	path: filePathSchema,
	items: v.pipe(
		v.array(
			v.object({
				// Kit hands uploads over as lazily read Blobs, which are not `instanceof File` under Bun
				file: v.custom<File>((f) => f instanceof Blob, 'Not a file'),
				path: v.pipe(v.string(), v.minLength(1), v.maxLength(1024))
			})
		),
		v.minLength(1),
		v.maxLength(2000)
	)
});

const pathList = v.pipe(
	v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(1024))),
	v.minLength(1),
	v.maxLength(500)
);

export const saveFilesSchema = v.object({
	id: idSchema,
	files: v.pipe(
		v.array(
			v.object({
				path: v.pipe(v.string(), v.minLength(1), v.maxLength(1024)),
				content: v.pipe(v.string(), v.maxLength(2_200_000)),
				baseHash: v.pipe(v.string(), v.regex(/^[0-9a-f]{40}$/))
			})
		),
		v.minLength(1),
		v.maxLength(200),
		v.check(
			(list) => list.reduce((sum, f) => sum + f.content.length, 0) <= 16_000_000,
			'Too much text to save at once'
		)
	)
});
export const removeFilesSchema = v.object({ id: idSchema, paths: pathList });
export const moveFilesSchema = v.object({ id: idSchema, paths: pathList, folder: filePathSchema });
