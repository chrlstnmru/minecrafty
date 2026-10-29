import { command, form, query } from '$app/server';
import * as v from 'valibot';
import { idSchema } from '#lib/schemas/common.js';
import { fileNameSchema, filePathSchema, uploadFilesSchema } from '#lib/schemas/files.js';
import { requireAdmin } from '#lib/server/auth.js';
import * as files from '#lib/server/files.js';
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

export const uploadFiles = form(
	uploadFilesSchema,
	async ({ id: instanceId, path, files: uploads }) => {
		requireAdmin();
		await userFacing(async () => {
			for (const file of uploads) await files.saveUpload(instanceId, path, file);
		});
		await listFiles({ id: instanceId, path }).refresh();
	}
);
