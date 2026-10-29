import { defineParams } from '@sveltejs/kit/params';

export const params = defineParams({
	// `[id=integer]` yields a number; symmetric with String(n) so resolve() round-trips
	integer: (param) => (/^(0|[1-9]\d*)$/.test(param) ? Number(param) : undefined)
});
