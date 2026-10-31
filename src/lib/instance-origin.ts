/** The columns of an instance row that say where its server came from. */
export type OriginFields = { packProjectId?: string | null; fromPackId?: number | null };

/** From a loader alone, from a Modrinth modpack, or from a pack made in the builder. */
export type InstanceOrigin = 'loader' | 'modrinth-pack' | 'builder-pack';

export function originOf(row: OriginFields): InstanceOrigin {
	if (row.packProjectId) return 'modrinth-pack';
	return row.fromPackId != null ? 'builder-pack' : 'loader';
}

/** Whether the server was made from a modpack, whichever kind: the pack decides its Minecraft version and loader. */
export const isFromPack = (row: OriginFields) => originOf(row) !== 'loader';

/** Whether a failed install can be run again from scratch: a pack's own files need the pack, so only a loader-only server can. */
export const canRetryInstall = (row: OriginFields) => originOf(row) === 'loader';
