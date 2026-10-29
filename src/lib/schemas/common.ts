import * as v from 'valibot';

// Building blocks shared by the remote functions' argument schemas.

export const idSchema = v.pipe(v.number(), v.integer(), v.minValue(1));
export const projectIdSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(64));
export const versionIdSchema = v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(64)));

/** Arguments of the Modrinth search queries (mods and resource packs). */
export const searchArgsSchema = v.object({
	id: idSchema,
	query: v.pipe(v.string(), v.maxLength(100)),
	limit: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100))
});
