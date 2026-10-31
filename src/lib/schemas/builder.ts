import * as v from 'valibot';

import { PACK_LOADERS } from '#lib/pack-loaders.js';

import { idSchema, projectIdSchema, versionIdSchema } from './common.js';

const mcVersion = v.pipe(v.string(), v.regex(/^\d+(\.\d+)*$/, 'Not a release version'));

export const newPackSchema = v.object({
	name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Give the pack a name'), v.maxLength(60)),
	loader: v.picklist(PACK_LOADERS, 'Choose a loader'),
	mcVersion
});

export const packArgs = v.object({ id: idSchema });
export const packProjectArgs = v.object({ id: idSchema, projectId: projectIdSchema });
export const addPackModSchema = v.object({
	id: idSchema,
	projectId: projectIdSchema,
	versionId: versionIdSchema
});
export const packFileArgs = v.object({ id: idSchema, fileId: idSchema });
export const packFileVersionSchema = v.object({
	id: idSchema,
	fileId: idSchema,
	versionId: v.pipe(v.string(), v.minLength(1), v.maxLength(64))
});
export const updatePackSchema = v.object({
	id: idSchema,
	name: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(60))),
	description: v.optional(v.pipe(v.string(), v.maxLength(500)))
});
export const mcChangeSchema = v.object({
	id: idSchema,
	mcVersion,
	dropIncompatible: v.optional(v.boolean(), false)
});
export const packLoaderVersionSchema = v.object({
	id: idSchema,
	loaderVersion: v.pipe(v.string(), v.trim(), v.minLength(1, 'Choose a build'), v.maxLength(64))
});
export const packSearchSchema = v.object({
	id: idSchema,
	query: v.pipe(v.string(), v.maxLength(100)),
	limit: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100))
});
const overridePath = v.pipe(v.string(), v.minLength(1), v.maxLength(512));

export const overridePathSchema = v.object({ id: idSchema, path: overridePath });
export const savePackConfigSchema = v.object({
	id: idSchema,
	path: overridePath,
	content: v.pipe(v.string(), v.maxLength(2_200_000)),
	baseHash: v.optional(v.pipe(v.string(), v.regex(/^[0-9a-f]{40}$/)))
});
export const savePackConfigsSchema = v.object({
	id: idSchema,
	files: v.pipe(
		v.array(
			v.object({
				path: overridePath,
				content: v.pipe(v.string(), v.maxLength(2_200_000)),
				baseHash: v.optional(v.pipe(v.string(), v.regex(/^[0-9a-f]{40}$/)))
			})
		),
		v.minLength(1),
		v.maxLength(200),
		v.check(
			(files) => files.reduce((sum, f) => sum + f.content.length, 0) <= 16_000_000,
			'Too much text to save at once'
		)
	)
});
export const overridePathsSchema = v.object({
	id: idSchema,
	paths: v.pipe(v.array(overridePath), v.minLength(1), v.maxLength(500))
});
export const movePackConfigsSchema = v.object({
	id: idSchema,
	paths: v.pipe(v.array(overridePath), v.minLength(1), v.maxLength(500)),
	folder: v.pipe(v.string(), v.maxLength(512))
});
export const movePackConfigSchema = v.object({
	id: idSchema,
	from: overridePath,
	to: overridePath
});
export const installFromPackSchema = v.object({
	id: idSchema,
	name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(60)),
	port: v.pipe(v.number(), v.integer(), v.minValue(1024), v.maxValue(65535)),
	ramMaxMb: v.pipe(v.number(), v.integer(), v.minValue(512), v.maxValue(131072)),
	eulaAccepted: v.boolean()
});
