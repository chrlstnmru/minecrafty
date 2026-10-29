import { command, form, query } from '$app/server';
import { z } from 'zod';
import { requireAdmin } from '#lib/server/auth.js';
import { userFacing } from '#lib/server/http.js';
import * as packs from '#lib/server/packs.js';

const id = z.number().int().positive();
const kind = z.enum(['resourcepack', 'shader']);
const projectId = z.string().min(1).max(64);
const versionId = z.string().min(1).max(64).optional();

export const installedPacks = query(z.object({ id, kind }), async ({ id: instanceId, kind }) => {
	requireAdmin();
	return packs.listPacks(instanceId, kind);
});

export const searchPacks = query(
	z.object({ id, kind, query: z.string().max(100), limit: z.number().int().min(1).max(100) }),
	async ({ id: instanceId, kind, query, limit }) => {
		requireAdmin();
		return userFacing(() => packs.search(instanceId, kind, query.trim(), limit));
	}
);

export const packVersions = query(
	z.object({ id, kind, projectId }),
	async ({ id: instanceId, kind, projectId }) => {
		requireAdmin();
		return userFacing(() => packs.listPackVersions(instanceId, kind, projectId));
	}
);

/** The address players use to reach the panel, if the admin set one. */
export const publicUrl = query(async () => {
	requireAdmin();
	return packs.configuredPublicUrl();
});

export const setPublicUrl = command(z.string().max(300), async (value) => {
	requireAdmin();
	await userFacing(async () => packs.setPublicUrl(value));
	await publicUrl().refresh();
});

export const uploadPack = form(
	z.object({
		id,
		kind,
		// the address the admin is browsing from; players need a reachable one, see packs.setPublicUrl
		origin: z.url(),
		// Kit hands over a lazily read Blob that is not `instanceof File` under Bun
		file: z.custom<File>((v) => v instanceof Blob, 'Choose a .zip file')
	}),
	async ({ id: instanceId, kind, origin, file }) => {
		requireAdmin();
		await userFacing(() => packs.uploadPack(instanceId, kind, file, new URL(origin).origin));
		await Promise.all([
			installedPacks({ id: instanceId, kind }).refresh(),
			kind === 'resourcepack' ? serverPack(instanceId).refresh() : Promise.resolve()
		]);
	}
);

export const serverPack = query(id, async (instanceId) => {
	requireAdmin();
	return packs.serverPack(instanceId);
});

export const installShader = command(
	z.object({ id, projectId, versionId }),
	async ({ id: instanceId, projectId, versionId }) => {
		requireAdmin();
		const result = await userFacing(() => packs.installShader(instanceId, projectId, versionId));
		await installedPacks({ id: instanceId, kind: 'shader' }).refresh();
		return result;
	}
);

export const useResourcePack = command(
	z.object({ id, projectId, versionId }),
	async ({ id: instanceId, projectId, versionId }) => {
		requireAdmin();
		const result = await userFacing(() => packs.useAsServerPack(instanceId, projectId, versionId));
		await serverPack(instanceId).refresh();
		return result;
	}
);

export const removePack = command(
	z.object({ id, kind, rowId: z.number().int().positive() }),
	async ({ id: instanceId, kind, rowId }) => {
		requireAdmin();
		await userFacing(async () => packs.removePack(instanceId, kind, rowId));
		await Promise.all([
			installedPacks({ id: instanceId, kind }).refresh(),
			kind === 'resourcepack' ? serverPack(instanceId).refresh() : Promise.resolve()
		]);
	}
);

export const setPackOptions = form(
	z.object({ id, required: z.boolean().default(false), prompt: z.string().max(200) }),
	async ({ id: instanceId, required, prompt }) => {
		requireAdmin();
		await userFacing(async () => packs.setServerPackOptions(instanceId, { required, prompt }));
		await serverPack(instanceId).refresh();
	}
);
