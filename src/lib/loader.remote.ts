import * as v from 'valibot';
import { command, query } from '$app/server';
import { idSchema } from '#lib/schemas/common.js';
import { requirePermission } from '#lib/server/auth.js';
import { userFacing } from '#lib/server/http.js';
import { loaderInfo, startLoaderUpdate } from '#lib/server/loader-update.js';
import { lastOutcome } from '#lib/server/update-outcome.js';

/** What the instance runs, the newest build, the versions on offer and how the last update ended. */
export const loaderStatus = query(idSchema, async (instanceId) => {
	requirePermission(instanceId, 'loader');
	return { ...(await userFacing(() => loaderInfo(instanceId))), outcome: lastOutcome(instanceId) };
});

const updateSchema = v.object({
	id: idSchema,
	mcVersion: v.pipe(v.string(), v.regex(/^\d+(\.\d+)*$/, 'Not a release version')),
	backup: v.boolean()
});

/** Starts the update and returns at once; progress shows through the instance's install state. */
export const updateLoader = command(updateSchema, async ({ id, mcVersion, backup }) => {
	requirePermission(id, 'loader');
	const { finished, ...started } = await userFacing(() =>
		startLoaderUpdate(id, { mcVersion, backup })
	);
	void finished;
	return started;
});
