import { command, query } from '$app/server';
import * as v from 'valibot';

import { isEditable } from '#lib/editable.js';
import { idSchema } from '#lib/schemas/common.js';
import {
	fileNameSchema,
	filePathSchema,
	moveFilesSchema,
	removeFilesSchema,
	saveFilesSchema,
	uploadBatchSchema
} from '#lib/schemas/files.js';
import { record } from '#lib/server/audit.js';
import { requirePermission } from '#lib/server/auth.js';
import * as files from '#lib/server/files.js';
import { userFacing } from '#lib/server/http.js';
import { isRunning } from '#lib/server/live-server.js';
import * as uploads from '#lib/server/uploads.js';

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

const listedPaths = (paths: string[]) =>
	paths.length > 3
		? `${paths.slice(0, 3).join(', ')} and ${paths.length - 3} more`
		: paths.join(', ');

/** Saves every edited file together; one that fails stops them all. */
export const saveFiles = command(saveFilesSchema, async ({ id: instanceId, files: list }) => {
	const user = requirePermission(instanceId, 'files');
	const { changed, hashes } = await userFacing(() =>
		files.saveFiles(
			user,
			instanceId,
			list.map((f) => ({ rel: f.path, content: f.content, baseHash: f.baseHash }))
		)
	);
	if (changed)
		record({
			action: 'file.save',
			summary: `Edited ${listedPaths(list.map((f) => f.path))}`,
			instanceId
		});
	await Promise.all(list.map((f) => readFile({ id: instanceId, path: f.path }).refresh()));
	return { hashes };
});

// the folder that holds the entry, so the listing on screen can be refreshed after a change
const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const parentOf = (path: string) => path.split('/').slice(0, -1).join('/');

/**
 * Reads the editable files now at these paths again: a read is cached by path, so an editor would
 * otherwise open what a deleted file there held. One that cannot be read (a folder) is skipped.
 */
const refreshReads = (instanceId: number, paths: string[]) =>
	Promise.all(
		paths
			.filter((path) => isEditable(path.slice(path.lastIndexOf('/') + 1)))
			.map((path) =>
				readFile({ id: instanceId, path })
					.refresh()
					.catch(() => undefined)
			)
	);

export const newFolder = command(
	v.object({ id, path: filePathSchema, name: fileNameSchema }),
	async ({ id: instanceId, path, name }) => {
		requirePermission(instanceId, 'files');
		await userFacing(async () => files.addFolder(instanceId, path, name));
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
		await refreshReads(instanceId, [joinPath(path, name)]);
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
		await refreshReads(instanceId, [joinPath(parentOf(path), name)]);
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
	await refreshReads(
		instanceId,
		items.map((item) => joinPath(path, item.path))
	);
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

const refreshListings = (instanceId: number, paths: string[]) =>
	Promise.all(
		[...new Set(paths.map(parentOf))].map((path) => listFiles({ id: instanceId, path }).refresh())
	);

export const removeFiles = command(removeFilesSchema, async ({ id: instanceId, paths }) => {
	requirePermission(instanceId, 'files');
	const removed = await userFacing(() => files.removeEntries(instanceId, paths));
	record({
		action: 'file.delete',
		summary: `Deleted ${removed} ${removed === 1 ? 'item' : 'items'}: ${listedPaths(paths)}`,
		instanceId
	});
	await refreshListings(instanceId, paths);
});

export const moveFiles = command(moveFilesSchema, async ({ id: instanceId, paths, folder }) => {
	const user = requirePermission(instanceId, 'files');
	const moved = await userFacing(() => files.moveEntries(user, instanceId, paths, folder));
	if (moved)
		record({
			action: 'file.rename',
			summary: `Moved ${moved} ${moved === 1 ? 'item' : 'items'} to ${folder || 'the server folder'}: ${listedPaths(paths)}`,
			instanceId
		});
	await refreshListings(instanceId, [...paths, joinPath(folder, 'x')]);
	await refreshReads(
		instanceId,
		paths.map((from) => joinPath(folder, from.slice(from.lastIndexOf('/') + 1)))
	);
});
