import * as v from 'valibot';

// Schemas live here, not in the `*.remote.ts` files (which cannot export them), so the browser
// can run the same rules before submitting. `_`-prefixed fields are never sent back to the client
// after a failed submit.

export const loginSchema = v.object({
	username: v.pipe(v.string(), v.trim(), v.minLength(1, 'Enter your username')),
	_password: v.pipe(v.string(), v.minLength(1, 'Enter your password'))
});

export const setupSchema = v.pipe(
	v.object({
		username: v.pipe(
			v.string(),
			v.trim(),
			v.regex(/^[\w.-]{3,32}$/, 'Use 3-32 letters, numbers, . _ -')
		),
		_password: v.pipe(v.string(), v.minLength(8, 'At least 8 characters')),
		_confirm: v.string(),
		_code: v.pipe(v.string(), v.trim(), v.minLength(1, 'Enter the setup code'))
	}),
	v.forward(
		v.partialCheck(
			[['_password'], ['_confirm']],
			(input) => input._password === input._confirm,
			'Passwords do not match'
		),
		['_confirm']
	)
);
