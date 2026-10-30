import { invalid } from '@sveltejs/kit';
import { form, query } from '$app/server';
import * as v from 'valibot';
import { projectIdSchema } from '#lib/schemas/common.js';
import { importModpackSchema } from '#lib/schemas/modpack.js';
import { requireAdmin } from '#lib/server/auth.js';
import { userFacing } from '#lib/server/http.js';
import * as modpacks from '#lib/server/modpacks.js';

export const searchModpacks = query(
	v.object({
		query: v.pipe(v.string(), v.maxLength(100)),
		limit: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)),
		includeClientOnly: v.optional(v.boolean(), false)
	}),
	async ({ query, limit, includeClientOnly }) => {
		requireAdmin();
		return userFacing(() => modpacks.searchModpacks(query.trim(), limit, includeClientOnly));
	}
);

export const modpackVersions = query(projectIdSchema, async (projectId) => {
	requireAdmin();
	return userFacing(() => modpacks.listModpackVersions(projectId));
});

/** Downloads (and caches) the pack to read it, so this can take a few seconds for a large one. */
export const modpackPreview = query(
	v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
	async (versionId) => {
		requireAdmin();
		return userFacing(() => modpacks.previewModpack(versionId));
	}
);

/** Creates the instance at once; the install itself carries on in the background. */
export const importModpack = form(importModpackSchema, async (data, issue) => {
	requireAdmin();
	try {
		await modpacks.startImport(data);
	} catch (e) {
		if (String(e).includes('UNIQUE'))
			invalid(issue.port('Port is already used by another instance'));
		invalid(e instanceof Error ? e.message : 'Could not import the modpack');
	}
});
