import * as v from 'valibot';
import { command, query } from '$app/server';
import { idSchema } from '#lib/schemas/common.js';
import { requirePermission } from '#lib/server/auth.js';
import { userFacing } from '#lib/server/http.js';
import {
	lastOutcome,
	modpackInfo,
	previewModpackUpdate,
	startModpackUpdate
} from '#lib/server/modpack-update.js';

const versionId = v.pipe(v.string(), v.minLength(1), v.maxLength(64));

/** The pack the instance came from, every version of it, and how the last update ended. */
export const modpackStatus = query(idSchema, async (instanceId) => {
	requirePermission(instanceId, 'mods');
	return { ...(await userFacing(() => modpackInfo(instanceId))), outcome: lastOutcome(instanceId) };
});

/** What updating to a version would change, without changing anything. */
export const modpackUpdatePreview = query(
	v.object({ id: idSchema, versionId, replaceConfigs: v.boolean() }),
	async ({ id, versionId, replaceConfigs }) => {
		requirePermission(id, 'mods');
		return userFacing(() => previewModpackUpdate(id, versionId, { replaceConfigs }));
	}
);

/** Starts the update and returns at once; progress shows through the instance's install state. */
export const updateModpack = command(
	v.object({ id: idSchema, versionId, backup: v.boolean(), replaceConfigs: v.boolean() }),
	async ({ id, versionId, backup, replaceConfigs }) => {
		requirePermission(id, 'mods');
		const { finished, plan } = await userFacing(() =>
			startModpackUpdate(id, { versionId, backup, replaceConfigs })
		);
		void finished;
		return { versionNumber: plan.versionNumber };
	}
);
