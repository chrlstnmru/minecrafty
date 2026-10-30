import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent }) => {
	const { panel } = await parent();
	if (!panel.includes('audit.read')) redirect(307, '/');
};
