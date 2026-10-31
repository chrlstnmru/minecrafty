import { command, query } from '$app/server';
import * as v from 'valibot';
import { idSchema } from '#lib/schemas/common.js';
import { fileNameSchema, filePathSchema, uploadBatchSchema } from '#lib/schemas/files.js';
import { requirePermission } from '#lib/server/auth.js';
import * as files from '#lib/server/files.js';
import * as uploads from '#lib/server/uploads.js';
import { record } from '#lib/server/audit.js';
import { userFacing } from '#lib/server/http.js';
import { isRunning } from '#lib/server/live-server.js';

const id = idSchema;
const location = v.object({ id, path: filePathSchema });

export const listFiles = query(location, async ({ id: instanceId, path }) => {
	requirePermission(instanceId, 'files');
	return userFacing(async () => ({
		...files.listDirectory(instanceId, path),
		running: await isRunning(instanceId)
	}));
});

export const readFile = query(location, async ({ id: instanceId, path }) => {
	requirePermission(instanceId, 'files');
	return userFacing(async () => files.readTextFile(instanceId, path));
});

export const saveFile = command(
	v.object({ id, path: filePathSchema, content: v.pipe(v.string(), v.maxLength(2_200_000)) }),
	async ({ id: instanceId, path, content }) => {
		const user = requirePermission(instanceId, 'files');
		await userFacing(async () => files.saveFile(user, instanceId, path, content));
		record({ action: 'file.save', summary: `Edited ${path}`, instanceId });
		await readFile({ id: instanceId, path }).refresh();
	}
);

// the folder that holds the entry, so the listing on screen can be refreshed after a change
const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const parentOf = (path: string) => path.split('/').slice(0, -1).join('/');

export const newFolder = command(
	v.object({ id, path: filePathSchema, name: fileNameSchema }),
	async ({ id: instanceId, path, name }) => {
		requirePermission(instanceId, 'files');
		await userFacing(async () => files.makeDirectory(instanceId, path, name));
		record({
			action: 'file.folder',
			summary: `Made the folder ${joinPath(path, name)}`,
			instanceId
		});
		await listFiles({ id: instanceId, path }).refresh();
	}
);

export const newFile = command(
	v.object({ id, path: filePathSchema, name: fileNameSchema }),
	async ({ id: instanceId, path, name }) => {
		const user = requirePermission(instanceId, 'files');
		await userFacing(async () => files.addFile(user, instanceId, path, name));
		record({
			action: 'file.create',
			summary: `Created ${joinPath(path, name)}`,
			instanceId
		});
		await listFiles({ id: instanceId, path }).refresh();
	}
);

export const renameFile = command(
	v.object({ id, path: filePathSchema, name: fileNameSchema }),
	async ({ id: instanceId, path, name }) => {
		const user = requirePermission(instanceId, 'files');
		await userFacing(() => files.moveEntry(user, instanceId, path, name));
		record({
			action: 'file.rename',
			summary: `Renamed ${path} to ${name}`,
			instanceId
		});
		await listFiles({ id: instanceId, path: parentOf(path) }).refresh();
	}
);

export const removeFile = command(
	v.object({ id, path: filePathSchema }),
	async ({ id: instanceId, path }) => {
		requirePermission(instanceId, 'files');
		await userFacing(() => files.removeEntry(instanceId, path));
		record({ action: 'file.delete', summary: `Deleted ${path}`, instanceId });
		await listFiles({ id: instanceId, path: parentOf(path) }).refresh();
	}
);

export const uploadFiles = command(uploadBatchSchema, async ({ id: instanceId, path, items }) => {
	const user = requirePermission(instanceId, 'files');
	await userFacing(() =>
		files.uploadFiles(user, instanceId, path, items, (relPath) =>
			record({ action: 'file.upload', summary: `Uploaded ${joinPath(path, relPath)}`, instanceId })
		)
	);
	await listFiles({ id: instanceId, path }).refresh();
});

const uploadId = v.pipe(v.string(), v.uuid());

export const beginUpload = command(
	v.object({
		id,
		path: filePathSchema,
		name: v.pipe(v.string(), v.minLength(1), v.maxLength(1024)),
		size: v.pipe(v.number(), v.integer(), v.minValue(0))
	}),
	async ({ id: instanceId, path, name, size }) => {
		const user = requirePermission(instanceId, 'files');
		return userFacing(async () => {
			await files.assertMayUpload(user, instanceId, path, name);
			return uploads.beginUpload({
				instanceId,
				userId: user.id,
				dirRel: path,
				relPath: name,
				size
			});
		});
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
		const user = requirePermission(instanceId, 'files');
		return userFacing(() =>
			uploads.writePiece({ uploadId, instanceId, userId: user.id, index, piece, sha256 })
		);
	}
);

/** Which pieces the server already has, so a retry sends only the rest. */
export const uploadProgress = command(
	v.object({ id, uploadId }),
	async ({ id: instanceId, uploadId }) => {
		const user = requirePermission(instanceId, 'files');
		return userFacing(async () => uploads.uploadStatus(uploadId, instanceId, user.id));
	}
);

export const finishUpload = command(
	v.object({ id, uploadId, path: filePathSchema }),
	async ({ id: instanceId, uploadId, path }) => {
		const user = requirePermission(instanceId, 'files');
		const shown = await userFacing(async () => {
			// the server may have started, or the role changed, since the upload began
			const pending = uploads.pendingTarget(uploadId, instanceId, user.id);
			await files.assertMayUpload(user, instanceId, pending.dirRel, pending.relPath);
			return uploads.finishUpload(uploadId, instanceId, user.id);
		});
		record({ action: 'file.upload', summary: `Uploaded ${shown}`, instanceId });
		await listFiles({ id: instanceId, path }).refresh();
		return shown;
	}
);

export const abortUpload = command(
	v.object({ id, uploadId }),
	async ({ id: instanceId, uploadId }) => {
		const user = requirePermission(instanceId, 'files');
		await userFacing(async () => uploads.abortUpload(uploadId, instanceId, user.id));
	}
);
