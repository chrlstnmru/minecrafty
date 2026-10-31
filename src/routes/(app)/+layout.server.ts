import { panelPermissionsFor, permissionsAnywhere } from '#lib/server/access.js';
import { availableUpdate } from '#lib/server/self-update.js';
import type { LayoutServerLoad } from './$types';

// the panel permissions are read on every load, so a changed role shows on the next navigation
export const load: LayoutServerLoad = ({ locals }) => ({
	user: locals.user!,
	panel: panelPermissionsFor(locals.user!),
	/** per-server permissions held on at least one server */
	anywhere: permissionsAnywhere(locals.user!),
	/** a newer Minecrafty release, for the owner's Settings badge (from the daily check, no fetch) */
	update: locals.user!.role === 'owner' ? (availableUpdate()?.version ?? null) : null
});
