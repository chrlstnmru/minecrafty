import { originOf } from '#lib/instance-origin.js';

import type { instances } from './db/schema';

import { getPack, loadLocalPack, localPackSource, localRevisionId } from './local-packs';
import { listModpackVersions, loadModpack, type LoadedPack, type ModpackVersion } from './modpacks';

type InstanceRow = typeof instances.$inferSelect;

export type ModpackInfo = {
	pack: { projectId: string; versionId: string; versionNumber: string; name: string } | null;
	/** `builder` for a pack from the modpack builder, which offers only its current revision */
	source: 'modrinth' | 'builder';
	versions: ModpackVersion[];
	error: string | null;
};

/** The modpack an instance follows, whichever kind it is. */
export type PackSource = {
	kind: 'modrinth' | 'builder';
	/** the id a loaded pack's summary carries: a Modrinth project id, or `local:<id>` */
	id: string;
	/** the version the instance runs: a Modrinth version id, or `rev:<n>`; null when none is recorded */
	installedVersionId: string | null;
	/** the version the instance runs, as a person reads it */
	installedLabel: string;
	/** Loads a version of the pack. A builder pack keeps only its current revision. */
	load(versionId: string): Promise<LoadedPack>;
	/** The pack and every version of it that an update could move to, newest first. */
	describe(): Promise<ModpackInfo>;
	/** The instance columns that record running this version. */
	recordVersion(version: { versionId: string; versionNumber: string }): Partial<InstanceRow>;
};

function modrinthSource(inst: InstanceRow): PackSource {
	const projectId = inst.packProjectId!;
	return {
		kind: 'modrinth',
		id: projectId,
		installedVersionId: inst.packVersionId,
		installedLabel: inst.packVersionNumber ?? 'the old version',
		load: (versionId) => loadModpack(versionId),
		async describe() {
			const pack = {
				projectId,
				versionId: inst.packVersionId ?? '',
				versionNumber: inst.packVersionNumber ?? '',
				name: inst.packName ?? inst.name
			};
			try {
				return {
					pack,
					source: 'modrinth',
					versions: await listModpackVersions(projectId),
					error: null
				};
			} catch (e) {
				return {
					pack,
					source: 'modrinth',
					versions: [],
					error: e instanceof Error ? e.message : 'Could not reach Modrinth'
				};
			}
		},
		recordVersion: ({ versionId, versionNumber }) => ({
			packVersionId: versionId,
			packVersionNumber: versionNumber
		})
	};
}

function builderSource(inst: InstanceRow): PackSource {
	const packId = inst.fromPackId!;
	const installed = inst.fromPackRevision ?? 0;
	return {
		kind: 'builder',
		id: localPackSource(packId),
		installedVersionId:
			inst.fromPackRevision != null ? localRevisionId(inst.fromPackRevision) : null,
		installedLabel: `revision ${inst.fromPackRevision}`,
		async load(versionId) {
			const pack = getPack(packId);
			if (versionId !== localRevisionId(pack.revision))
				throw new Error('The pack has changed since this page loaded; reload it');
			return loadLocalPack(packId);
		},
		async describe() {
			const pack = {
				projectId: localPackSource(packId),
				versionId: localRevisionId(installed),
				versionNumber: `revision ${installed}`,
				name: inst.packName ?? inst.name
			};
			const version = (revision: number, at: Date | null): ModpackVersion => ({
				id: localRevisionId(revision),
				versionNumber: `revision ${revision}`,
				versionType: 'release',
				publishedAt: (at ?? new Date(0)).toISOString(),
				gameVersions: [],
				loaders: []
			});
			let current;
			try {
				current = getPack(packId);
			} catch {
				return {
					pack,
					source: 'builder',
					versions: [],
					error: 'The builder pack this server was made from has been deleted'
				};
			}
			const versions =
				current.revision === installed
					? [version(installed, current.updatedAt)]
					: [version(current.revision, current.updatedAt), version(installed, null)];
			return { pack: { ...pack, name: current.name }, source: 'builder', versions, error: null };
		},
		recordVersion: ({ versionId }) => ({
			fromPackRevision: Number(versionId.slice('rev:'.length))
		})
	};
}

/** The modpack the instance follows, or null when it was not made from one. */
export function packSourceOf(inst: InstanceRow): PackSource | null {
	switch (originOf(inst)) {
		case 'modrinth-pack':
			return modrinthSource(inst);
		case 'builder-pack':
			return builderSource(inst);
		case 'loader':
			return null;
	}
}
