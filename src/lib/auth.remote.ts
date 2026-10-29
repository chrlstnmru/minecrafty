import { invalid, redirect } from '@sveltejs/kit';
import { form, getRequestEvent } from '$app/server';
import { z } from 'zod';
import { createUser, endSession, hasUsers, startSession, verifyLogin } from '#lib/server/auth.js';

// `_`-prefixed fields are never sent back to the client after a failed submit
export const login = form(
	z.object({
		username: z.string().trim().min(1, 'Enter your username'),
		_password: z.string().min(1, 'Enter your password')
	}),
	async ({ username, _password }) => {
		const user = await verifyLogin(username, _password);
		if (!user) invalid('Invalid username or password');

		startSession(getRequestEvent().cookies, user.id);
		redirect(303, '/');
	}
);

export const setup = form(
	z
		.object({
			username: z
				.string()
				.trim()
				.regex(/^[\w.-]{3,32}$/, 'Use 3-32 letters, numbers, . _ -'),
			_password: z.string().min(8, 'At least 8 characters'),
			_confirm: z.string()
		})
		.refine((d) => d._password === d._confirm, {
			path: ['_confirm'],
			message: 'Passwords do not match'
		}),
	async ({ username, _password }) => {
		// the hook blocks /setup once a user exists; re-check in case of a race
		if (hasUsers()) redirect(303, '/login');

		const user = await createUser(username, _password, 'admin');
		startSession(getRequestEvent().cookies, user.id);
		redirect(303, '/');
	}
);

export const logout = form(async () => {
	endSession(getRequestEvent().cookies);
	redirect(303, '/login');
});
