import { redirect } from '@sveltejs/kit';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { hasUsers, userFromCookies } from '#lib/server/auth.js';
import { autoStartInstances, failInterruptedInstalls } from '#lib/server/instances.js';
import { startScheduler } from '#lib/server/schedules.js';
import { startStats } from '#lib/server/stats.js';
import { sweepUploads } from '#lib/server/uploads.js';

const PUBLIC = ['/login', '/setup'];

// uploads (the file manager) need a large request limit, so only signed-in users may send a body
// that is big or of unknown length; everyone else gets a small cap before anything reads it
const ANONYMOUS_BODY_LIMIT = 64 * 1024;

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	const { method, headers } = event.request;
	if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
		const length = headers.get('content-length');
		if (
			(length === null || Number(length) > ANONYMOUS_BODY_LIMIT) &&
			!userFromCookies(event.cookies)
		)
			return new Response('Payload too large', { status: 413 });
	}

	// remote functions (login, setup, ...) enforce their own access rules
	if (event.isRemoteRequest) {
		event.locals.user = userFromCookies(event.cookies);
		return resolve(event);
	}

	const isPublic = PUBLIC.includes(pathname);

	// first run: nothing works until the admin account exists
	if (!hasUsers()) {
		if (pathname !== '/setup') redirect(303, '/setup');
		return resolve(event);
	}

	event.locals.user = userFromCookies(event.cookies);

	if (!event.locals.user && !isPublic) redirect(303, '/login');
	if (event.locals.user && isPublic) redirect(303, '/');
	if (pathname === '/setup') redirect(303, '/login');

	return resolve(event);
};

export const init: ServerInit = () => {
	// the build analyses the app by running it; never start servers (or touch the data dir) then
	if (building) return;
	failInterruptedInstalls();
	sweepUploads();
	// scheduled tasks run from here on, once a minute
	startScheduler();
	// CPU, memory, players and folder sizes, for the dashboard
	startStats();
	// don't hold up the panel while Java servers boot
	void autoStartInstances();
};
