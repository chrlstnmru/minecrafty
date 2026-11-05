import { and, eq, inArray } from 'drizzle-orm';
import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

import type { ModrinthProject, ModrinthVersion } from './modrinth';

import { serverDir } from './config';
import { db } from './db';
import { installedMods } from './db/schema';

// Every write to the installed_mods table, and the `.disabled` rule: a disabled mod keeps its file,
// renamed so the loader no longer sees a jar.

export type InstalledMod = typeof installedMods.$inferSelect;
type NewRow = typeof installedMods.$inferInsert;
type Sides = Pick<NewRow, 'clientSide' | 'serverSide'>;

const DISABLED_SUFFIX = '.disabled';

export const isDisabled = (file: string) => file.endsWith(DISABLED_SUFFIX);
export const disabledPath = (file: string) => file + DISABLED_SUFFIX;
export const enabledPath = (file: string) =>
	isDisabled(file) ? file.slice(0, -DISABLED_SUFFIX.length) : file;

/** The row for a mod file from Modrinth; `project` is missing when Modrinth did not return it. */
export function modRow(mod: {
	instanceId: number;
	projectId: string;
	version: Pick<ModrinthVersion, 'id' | 'version_number'>;
	project?: ModrinthProject;
	file: string;
	hash: string;
	dependencyOf?: string | null;
}): NewRow {
	return {
		instanceId: mod.instanceId,
		kind: 'mod',
		source: 'modrinth',
		projectId: mod.projectId,
		versionId: mod.version.id,
		title: mod.project?.title ?? mod.projectId,
		iconUrl: mod.project?.icon_url ?? null,
		versionNumber: mod.version.version_number,
		clientSide: mod.project?.client_side ?? null,
		serverSide: mod.project?.server_side ?? null,
		file: mod.file,
		hash: mod.hash,
		dependencyOf: mod.dependencyOf ?? null
	};
}

/** Records installed mods. `replacing`'s row is rewritten, so its id stays stable for the UI. */
export function saveMods(rows: NewRow[], replacing?: InstalledMod) {
	db.transaction((tx) => {
		for (const row of rows) {
			if (replacing && row.projectId === replacing.projectId)
				tx.update(installedMods).set(row).where(eq(installedMods.id, replacing.id)).run();
			else tx.insert(installedMods).values(row).run();
		}
	});
}

/** Records a pack's mods, leaving any project the instance already has alone. */
export function addNewMods(rows: NewRow[]) {
	if (rows.length) db.insert(installedMods).values(rows).onConflictDoNothing().run();
}

export function removeRow(rowId: number) {
	db.delete(installedMods).where(eq(installedMods.id, rowId)).run();
}

/** Drops the rows of these files, whether each is enabled or disabled. */
export function forgetFiles(instanceId: number, files: string[]) {
	if (!files.length) return;
	db.delete(installedMods)
		.where(
			and(
				eq(installedMods.instanceId, instanceId),
				inArray(installedMods.file, [...files, ...files.map(disabledPath)])
			)
		)
		.run();
}

export function setSides(rowId: number, sides: Sides) {
	db.update(installedMods).set(sides).where(eq(installedMods.id, rowId)).run();
}

/** Makes `row` the instance's one server resource pack. */
export function setServerPackRow(instanceId: number, row: Omit<NewRow, 'instanceId' | 'kind'>) {
	db.transaction((tx) => {
		tx.delete(installedMods)
			.where(and(eq(installedMods.instanceId, instanceId), eq(installedMods.kind, 'resourcepack')))
			.run();
		tx.insert(installedMods)
			.values({ ...row, instanceId, kind: 'resourcepack' })
			.run();
	});
}

/**
 * Turns the mod at `file` on or off by renaming it, and keeps its row in step if it has one: a jar
 * Modrinth does not know has none, and the file on disk is what the loader goes by.
 */
export function setFileEnabled(instanceId: number, file: string, enabled: boolean) {
	if (isDisabled(file) === !enabled) return;
	const next = enabled ? enabledPath(file) : disabledPath(file);
	const root = serverDir(instanceId);
	if (!existsSync(join(root, file))) throw new Error(`${file} is missing`);
	if (existsSync(join(root, next))) throw new Error(`${next} already exists`);
	renameSync(join(root, file), join(root, next));
	db.update(installedMods)
		.set({ file: next })
		.where(and(eq(installedMods.instanceId, instanceId), eq(installedMods.file, file)))
		.run();
}
