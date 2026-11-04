import { redirect } from '@sveltejs/kit';

import type { PageLoad } from './$types';

// settings change the pack, so only those who may change it see them
export const load: PageLoad = async ({ parent, params }) => {
	const { panel } = await parent();
	if (!panel.includes('modpacks.write')) redirect(307, `/modpacks/${params.id}/mods`);
};
