import { query } from '$app/server';

import { visibleInstanceIds } from '#lib/server/access.js';
import { requireUser } from '#lib/server/auth.js';
import { overview } from '#lib/server/overview.js';
import { statsFor } from '#lib/server/stats.js';

/** The host's and each server's numbers as they are now; the `stats` feed keeps them current. */
export const statsNow = query(async () => statsFor(requireUser()));

/** The last backup and the next scheduled task across the servers the user may see. */
export const overviewNow = query(async () => {
	const user = requireUser();
	return overview(new Date(), visibleInstanceIds(user));
});
