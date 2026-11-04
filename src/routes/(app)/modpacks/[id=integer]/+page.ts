import { redirect } from '@sveltejs/kit';

import type { PageLoad } from './$types';

// each section has its own page; links from before that used ?tab=, which still land in the right one
const SECTIONS = ['mods', 'resource-packs', 'configs', 'settings'];

export const load: PageLoad = ({ params, url }) => {
	const tab = url.searchParams.get('tab');
	const view = url.searchParams.get('view');
	const section = tab && SECTIONS.includes(tab) ? tab : 'mods';
	redirect(
		307,
		`/modpacks/${params.id}/${section}${view ? `?view=${encodeURIComponent(view)}` : ''}`
	);
};
