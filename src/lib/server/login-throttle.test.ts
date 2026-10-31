import { beforeEach, describe, expect, it } from 'vitest';

import * as T from './login-throttle';

const MINUTE = 60_000;
const fail = (times: number, address = '10.0.0.1', username = 'alex', now = 0) => {
	for (let i = 0; i < times; i++) T.recordLoginFailure(address, username, now);
};

beforeEach(() => T.resetLoginThrottle());

describe('login throttle', () => {
	it('lets four failures through and blocks the fifth for the rest of 15 minutes', () => {
		fail(4);
		expect(T.loginBlockedFor('10.0.0.1', 'alex', MINUTE)).toBe(0);
		fail(1);
		expect(T.loginBlockedFor('10.0.0.1', 'alex', MINUTE)).toBe(14 * MINUTE);
		expect(T.loginBlockedFor('10.0.0.1', 'alex', 15 * MINUTE)).toBe(0);
	});

	it('blocks only that username from that address', () => {
		fail(5);
		expect(T.loginBlockedFor('10.0.0.1', 'ALEX', 0)).toBeGreaterThan(0);
		expect(T.loginBlockedFor('10.0.0.1', 'sam', 0)).toBe(0);
		expect(T.loginBlockedFor('10.0.0.2', 'alex', 0)).toBe(0);
	});

	it('blocks an address that tries many usernames', () => {
		for (let i = 0; i < 30; i++) fail(1, '10.0.0.1', `user${i}`);
		expect(T.loginBlockedFor('10.0.0.1', 'someone-new', 0)).toBeGreaterThan(0);
		expect(T.loginBlockedFor('10.0.0.2', 'someone-new', 0)).toBe(0);
	});

	it('clears the username count on a good password, but not the address count', () => {
		fail(4);
		T.recordLoginSuccess('10.0.0.1', 'alex');
		fail(4);
		expect(T.loginBlockedFor('10.0.0.1', 'alex', 0)).toBe(0);
		for (let i = 0; i < 22; i++) fail(1, '10.0.0.1', `user${i}`);
		expect(T.loginBlockedFor('10.0.0.1', 'alex', 0)).toBeGreaterThan(0);
	});
});
