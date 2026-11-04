// What a pack's files are, for the pages and the server alike.

import type { ModListItem } from '#lib/mod-list.js';

import { under } from '#lib/paths.js';

/** Where a pack keeps client resource packs; everything else it downloads is a mod. */
export const RESOURCE_PACKS = 'resourcepacks';

export const isResourcePack = (file: { path: string }) => under(file.path, RESOURCE_PACKS);

type PackFile = Omit<ModListItem, 'key' | 'file' | 'enabled' | 'fromModrinth'> & { path: string };

/** A pack file as a row of the mod list. */
export const fileItem = (file: PackFile): ModListItem => ({
	...file,
	key: String(file.id),
	file: file.path,
	enabled: true,
	fromModrinth: !!file.projectId
});

/** The pack's server resource pack as a row, pinned first and tagged; none when it has none. */
export function serverPackItems(pack: {
	serverPackProjectId: string | null;
	serverPackVersionId: string | null;
	serverPackVersionNumber: string | null;
	serverPackTitle: string | null;
	serverPackIconUrl: string | null;
}): ModListItem[] {
	if (!pack.serverPackProjectId) return [];
	return [
		{
			key: 'server-pack',
			id: null,
			projectId: pack.serverPackProjectId,
			title: pack.serverPackTitle ?? pack.serverPackProjectId,
			iconUrl: pack.serverPackIconUrl,
			file: '',
			versionNumber: pack.serverPackVersionNumber,
			versionId: pack.serverPackVersionId,
			dependencyOf: null,
			clientSide: null,
			serverSide: null,
			enabled: true,
			fromModrinth: true,
			tag: {
				label: 'Server pack',
				title: 'Servers made from this pack start with it. It is not in the .mrpack.'
			}
		}
	];
}
