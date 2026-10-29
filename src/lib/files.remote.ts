import { command, query } from '$app/server';
import * as v from 'valibot';
import { idSchema } from '#lib/schemas/common.js';
import { fileNameSchema, filePathSchema, uploadBatchSchema } from '#lib/schemas/files.js';
import { requireAdmin } from '#lib/server/auth.js';
import * as files from '#lib/server/files.js';
import * as uploads from '#lib/server/uploads.js';
import { userFacing } from '#lib/server/http.js';

const id = idSchema;
const location = v.object({ id, path: filePathSchema });

export const listFiles = query(location, async ({ id: instanceId, path }) => {
	requireAdmin();
	return userFacing(async () => files.listDirectory(instanceId, path));
});

export const readFile = query(location, async ({ id: instanceId, path }) => {
	requireAdmin();
	return userFacing(async () => files.readTextFile(instanceId, path));
});

export const saveFile = command(
	v.object({ id, path: filePathSchema, content: v.pipe(v.string(), v.maxLength(2_200_000)) }),
	async ({ id: instanceId, path, content }) => {
		requireAdmin();
		await userFacing(async () => files.writeTextFile(instanceId, path, content));
		await readFile({ id: instanceId, path }).refresh();
	}
);

// the folder that holds the entry, so the listing on screen can be refreshed after a change
const parentOf = (path: string) => path.split('/').slice(0, -1).join('/');

export const newFolder = command(
	v.object({ id, path: filePathSchema, name: fileNameSchema }),
	async ({ id: instanceId, path, name }) => {
		requireAdmin();
		await userFacing(async () => files.makeDirectory(instanceId, path, name));
		await listFiles({ id: instanceId, path }).refresh();
	}
);

export const newFile = command(
	v.object({ id, path: filePathSchema, name: fileNameSchema }),
	async ({ id: instanceId, path, name }) => {
		requireAdmin();
		await userFacing(async () => files.createTextFile(instanceId, path, name));
		await listFiles({ id: instanceId, path }).refresh();
	}
);

export const renameFile = command(
	v.object({ id, path: filePathSchema, name: fileNameSchema }),
	async ({ id: instanceId, path, name }) => {
		requireAdmin();
		await userFacing(async () => files.renameEntry(instanceId, path, name));
		await listFiles({ id: instanceId, path: parentOf(path) }).refresh();
	}
);

export const removeFile = command(
	v.object({ id, path: filePathSchema }),
	async ({ id: instanceId, path }) => {
		requireAdmin();
		await userFacing(async () => files.deleteEntry(instanceId, path));
		await listFiles({ id: instanceId, path: parentOf(path) }).refresh();
	}
);

export const uploadFiles = command(uploadBatchSchema, async ({ id: instanceId, path, items }) => {
	requireAdmin();
	await userFacing(async () => {
		for (const { file, path: relPath } of items)
			await files.saveUpload(instanceId, path, file, relPath);
	});
	await listFiles({ id: instanceId, path }).refresh();
});

// --- chunked uploads (large files): begin, send pieces, finish. See server/uploads.ts.

const uploadId = v.pipe(v.string(), v.uuid());

export const beginUpload = command(
	v.object({
		id,
		path: filePathSchema,
		name: v.pipe(v.string(), v.minLength(1), v.maxLength(1024)),
		size: v.pipe(v.number(), v.integer(), v.minValue(0))
	}),
	async ({ id: instanceId, path, name, size }) => {
		const user = requireAdmin();
		return userFacing(async () =>
			uploads.beginUpload({ instanceId, userId: user.id, dirRel: path, relPath: name, size })
		);
	}
);

export const uploadPiece = command(
	v.object({
		id,
		uploadId,
		index: v.pipe(v.number(), v.integer(), v.minValue(0)),
		// Kit hands uploads over as lazily read Blobs, which are not `instanceof File` under Bun
		piece: v.custom<File>((f) => f instanceof Blob, 'Not a piece'),
		sha256: v.optional(v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/i)))
	}),
	async ({ id: instanceId, uploadId, index, piece, sha256 }) => {
		const user = requireAdmin();
		return userFacing(() =>
			uploads.writePiece({ uploadId, instanceId, userId: user.id, index, piece, sha256 })
		);
	}
);

/** Which pieces the server already has, so a retry sends only the rest. */
export const uploadProgress = command(
	v.object({ id, uploadId }),
	async ({ id: instanceId, uploadId }) => {
		const user = requireAdmin();
		return userFacing(async () => uploads.uploadStatus(uploadId, instanceId, user.id));
	}
);

export const finishUpload = command(
	v.object({ id, uploadId, path: filePathSchema }),
	async ({ id: instanceId, uploadId, path }) => {
		const user = requireAdmin();
		const shown = await userFacing(async () => uploads.finishUpload(uploadId, instanceId, user.id));
		await listFiles({ id: instanceId, path }).refresh();
		return shown;
	}
);

export const abortUpload = command(
	v.object({ id, uploadId }),
	async ({ id: instanceId, uploadId }) => {
		const user = requireAdmin();
		await userFacing(async () => uploads.abortUpload(uploadId, instanceId, user.id));
	}
);
