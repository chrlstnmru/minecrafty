import { redirect } from '@sveltejs/kit';

import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ parent }) => {
	const { panel } = await parent();
	if (!panel.includes('modpacks.read')) redirect(307, '/');
};
