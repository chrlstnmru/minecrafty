import { invalid, redirect } from '@sveltejs/kit';
import { form, getRequestEvent } from '$app/server';
import { loginSchema, setupSchema } from '#lib/schemas/auth.js';
import { createUser, endSession, hasUsers, startSession, verifyLogin } from '#lib/server/auth.js';

export const login = form(loginSchema, async ({ username, _password }) => {
	const user = await verifyLogin(username, _password);
	if (!user) invalid('Invalid username or password');

	startSession(getRequestEvent().cookies, user.id);
	redirect(303, '/');
});

export const setup = form(setupSchema, async ({ username, _password }) => {
	// the hook blocks /setup once a user exists; re-check in case of a race
	if (hasUsers()) redirect(303, '/login');

	const user = await createUser(username, _password, 'owner');
	startSession(getRequestEvent().cookies, user.id);
	redirect(303, '/');
});

export const logout = form(async () => {
	endSession(getRequestEvent().cookies);
	redirect(303, '/login');
});
