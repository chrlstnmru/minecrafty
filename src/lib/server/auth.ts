import { error } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import { db } from './db';
import { sessions, users } from './db/schema';
import type { InstancePermission, PanelPermission } from '#lib/permissions.js';
import { can, canSee, check } from './access';
import { createAccount } from './user-admin';

const COOKIE = 'session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionUser = Pick<typeof users.$inferSelect, 'id' | 'username' | 'role'>;

/**
 * Kit marks cookies Secure everywhere but http://localhost, and a browser drops a Secure cookie sent
 * over plain http, so signing in at http://<lan-ip>:3000 would never stick. Secure only over https.
 */
const cookieOptions = () => ({
	path: '/',
	httpOnly: true,
	sameSite: 'lax' as const,
	secure: getRequestEvent().url.protocol === 'https:'
});

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
	cookies.set(COOKIE, token, { ...cookieOptions(), expires: expiresAt });
}

export function endSession(cookies: Cookies) {
	const token = cookies.get(COOKIE);
	if (token)
		db.delete(sessions)
			.where(eq(sessions.id, hashToken(token)))
			.run();
	cookies.delete(COOKIE, cookieOptions());
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
export function requirePermission(instanceId: number, needed: InstancePermission) {
	const user = requireUser();
	const result = check(user, instanceId, needed);
	if (result === 'unknown') error(404, 'Instance not found');
	if (result === 'denied') error(403, 'You do not have permission to do that');
	return user;
}

/** Any permission on the instance is enough to see it; one the user cannot see is 404. */
export function requireInstance(instanceId: number) {
	const user = requireUser();
	if (!canSee(user, instanceId)) error(404, 'Instance not found');
	return user;
}

/** A panel-wide permission: creating instances, managing users and roles. */
export function requirePanel(needed: PanelPermission) {
	const user = requireUser();
	if (!can(user, needed)) error(403, 'You do not have permission to do that');
	return user;
}

/** What only the owner may do. */
export function requireOwner() {
	const { locals } = getRequestEvent();
	if (!locals.user) error(401, 'Not signed in');
	if (locals.user.role !== 'owner') error(403, 'Owner only');
	return locals.user;
}
