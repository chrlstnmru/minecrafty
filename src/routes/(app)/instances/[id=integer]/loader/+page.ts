import { redirect } from '@sveltejs/kit';

import type { PageLoad } from './$types';

// the Loader tab is now a card on Settings; old links still land on it
export const load: PageLoad = ({ params }) =>
	redirect(308, `/instances/${params.id}/settings#loader`);
