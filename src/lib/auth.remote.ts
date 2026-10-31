import { form, getRequestEvent } from '$app/server';
import { invalid, redirect } from '@sveltejs/kit';

import { loginSchema, setupSchema } from '#lib/schemas/auth.js';
import { record } from '#lib/server/audit.js';
import { createUser, endSession, hasUsers, startSession, verifyLogin } from '#lib/server/auth.js';
import {
	loginBlockedFor,
	recordLoginFailure,
	recordLoginSuccess
} from '#lib/server/login-throttle.js';
import { checkSetupToken, clearSetupToken } from '#lib/server/setup-token.js';

export const login = form(loginSchema, async ({ username, _password }) => {
	const address = getRequestEvent().getClientAddress();
	const wait = loginBlockedFor(address, username);
	if (wait > 0) {
		const minutes = Math.ceil(wait / 60_000);
		invalid(`Too many failed sign-ins. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}`);
	}

	const user = await verifyLogin(username, _password);
	if (!user) {
		recordLoginFailure(address, username);
		record(
			{ action: 'auth.failed', summary: `Failed sign-in as ${username}` },
			{ id: null, name: 'Someone' }
		);
		invalid('Invalid username or password');
	}

	recordLoginSuccess(address, username);
	startSession(getRequestEvent().cookies, user.id);
	record({ action: 'auth.login', summary: 'Signed in' }, { id: user.id, name: user.username });
	redirect(303, '/');
});

export const setup = form(setupSchema, async ({ username, _password, _code }, issue) => {
	// the hook blocks /setup once a user exists; re-check in case of a race
	if (hasUsers()) redirect(303, '/login');
	if (!checkSetupToken(_code)) invalid(issue._code('That is not the setup code'));

	const user = await createUser(username, _password, 'owner');
	clearSetupToken();
	record(
		{ action: 'auth.setup', summary: 'Created the owner account' },
		{ id: user.id, name: user.username }
	);
	startSession(getRequestEvent().cookies, user.id);
	redirect(303, '/');
});

export const logout = form(async () => {
	endSession(getRequestEvent().cookies);
	redirect(303, '/login');
});
