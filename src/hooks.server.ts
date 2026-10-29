import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { hasUsers, userFromCookies } from '#lib/server/auth.js';

const PUBLIC = ['/login', '/setup'];

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;
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
