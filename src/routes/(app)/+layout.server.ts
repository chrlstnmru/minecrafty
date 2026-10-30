import { panelPermissionsFor } from '#lib/server/access.js';
import type { LayoutServerLoad } from './$types';

// the panel permissions are read on every load, so a changed role shows on the next navigation
export const load: LayoutServerLoad = ({ locals }) => ({
	user: locals.user!,
	panel: panelPermissionsFor(locals.user!)
});
