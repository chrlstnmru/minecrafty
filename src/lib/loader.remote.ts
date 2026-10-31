import { command, query } from '$app/server';
import * as v from 'valibot';

import { idSchema } from '#lib/schemas/common.js';
import { record } from '#lib/server/audit.js';
import { requirePermission } from '#lib/server/auth.js';
import { userFacing } from '#lib/server/http.js';
import { buildsFor, loaderInfo, startLoaderUpdate } from '#lib/server/loader-update.js';
import { lastOutcome } from '#lib/server/update-outcome.js';

/** What the instance runs, the newest build, the versions on offer and how the last update ended. */
export const loaderStatus = query(idSchema, async (instanceId) => {
	requirePermission(instanceId, 'loader');
	return { ...(await userFacing(() => loaderInfo(instanceId))), outcome: lastOutcome(instanceId) };
});

const mcVersion = v.pipe(v.string(), v.regex(/^\d+(\.\d+)*$/, 'Not a release version'));

/** The builds on offer for a Minecraft version, newest first; empty for vanilla. */
export const loaderBuilds = query(
	v.object({ id: idSchema, mcVersion }),
	async ({ id, mcVersion }) => {
		requirePermission(id, 'loader');
		return userFacing(() => buildsFor(id, mcVersion));
	}
);

const updateSchema = v.object({
	id: idSchema,
	mcVersion,
	build: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(64))),
	backup: v.boolean()
});

/** Starts the update and returns at once; progress shows through the instance's install state. */
export const updateLoader = command(updateSchema, async ({ id, mcVersion, build, backup }) => {
	requirePermission(id, 'loader');
	const { finished, ...started } = await userFacing(() =>
		startLoaderUpdate(id, { mcVersion, build, backup })
	);
	void finished;
	record({
		action: 'loader.update',
		summary: `Started updating the loader to Minecraft ${mcVersion}${build ? ` (build ${build})` : ''}${backup ? ' (with a backup)' : ''}`,
		instanceId: id
	});
	return started;
});
