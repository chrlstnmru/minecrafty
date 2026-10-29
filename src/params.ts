import { defineParams } from '@sveltejs/kit/params';
import { plannedSlugs } from '#lib/instance-slugs.js';

export const params = defineParams({
	// `[id=integer]` yields a number; symmetric with String(n) so resolve() round-trips
	integer: (param) => (/^(0|[1-9]\d*)$/.test(param) ? Number(param) : undefined),
	// instance modules that exist in the tab bar but are not built yet
	planned: (param) => ((plannedSlugs as readonly string[]).includes(param) ? param : undefined)
});
