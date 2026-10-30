import { error } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import { db } from './db';
import { sessions, users } from './db/schema';
import type { Permission, SettingField } from '#lib/permissions.js';
import { check, restrictionsFor } from './access';
import { createAccount } from './user-admin';

const COOKIE = 'session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionUser = Pick<typeof users.$inferSelect, 'id' | 'username' | 'role'>;

const hashToken = (token: string) => new Bun.CryptoHasher('sha256').update(token).digest('hex');

export function hasUsers() {
	return db.select({ id: users.id }).from(users).limit(1).get() !== undefined;
}

export const createUser = createAccount;

export async function verifyLogin(username: string, password: string) {
	const user = db.select().from(users).where(eq(users.username, username)).get();
	// verify against a dummy hash on unknown users so timing doesn't reveal them
	const ok = await Bun.password.verify(password, user?.passwordHash ?? DUMMY_HASH);
	return user && ok ? user : null;
}

const DUMMY_HASH = await Bun.password.hash('dummy', 'argon2id');

export function startSession(cookies: Cookies, userId: number) {
	const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
	const expiresAt = new Date(Date.now() + SESSION_MS);
	db.delete(sessions).where(lt(sessions.expiresAt, new Date())).run();
	db.insert(sessions)
		.values({ id: hashToken(token), userId, expiresAt })
		.run();
	cookies.set(COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', expires: expiresAt });
}

export function endSession(cookies: Cookies) {
	const token = cookies.get(COOKIE);
	if (token)
		db.delete(sessions)
			.where(eq(sessions.id, hashToken(token)))
			.run();
	cookies.delete(COOKIE, { path: '/' });
}

export function userFromCookies(cookies: Cookies): SessionUser | null {
	const token = cookies.get(COOKIE);
	if (!token) return null;
	return (
		db
			.select({ id: users.id, username: users.username, role: users.role })
			.from(sessions)
			.innerJoin(users, eq(users.id, sessions.userId))
			.where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())))
			.get() ?? null
	);
}

/** Any signed-in user; for what is not tied to one instance. */
export function requireUser() {
	const { locals } = getRequestEvent();
	if (!locals.user) error(401, 'Not signed in');
	return locals.user;
}

/** Guards one instance: unseen instances are 404, seen but not allowed is 403. */
export function requirePermission(instanceId: number, needed: Permission) {
	const user = requireUser();
	const result = check(user, instanceId, needed);
	if (result === 'unknown') error(404, 'Instance not found');
	if (result === 'denied') error(403, 'You do not have permission to do that');
	return user;
}

/** Refuses a change to a setting the user's role locks. */
export function requireUnlocked(instanceId: number, field: SettingField) {
	const user = requireUser();
	if (restrictionsFor(user, instanceId).settings.includes(field))
		error(403, 'Your role cannot change this');
	return user;
}

/** Host-wide and account operations. */
export function requireAdmin() {
	const { locals } = getRequestEvent();
	if (!locals.user) error(401, 'Not signed in');
	if (locals.user.role !== 'admin') error(403, 'Admin only');
	return locals.user;
}
