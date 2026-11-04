// Looking up who a session token belongs to. Kept apart from auth.ts, which needs a Kit request,
// so the live feeds' socket (which never reaches Kit) can sign in too.

import { and, eq, gt } from 'drizzle-orm';

import { db } from './db';
import { sessions, users } from './db/schema';

export const COOKIE = 'session';

export type SessionUser = Pick<typeof users.$inferSelect, 'id' | 'username' | 'role'>;

export const hashToken = (token: string) =>
	new Bun.CryptoHasher('sha256').update(token).digest('hex');

/** The session token in a raw `Cookie` header, for requests that never reach Kit (WebSockets). */
export function sessionToken(cookieHeader: string | null): string | undefined {
	for (const part of cookieHeader?.split(';') ?? []) {
		const [name, ...value] = part.trim().split('=');
		if (name !== COOKIE) continue;
		try {
			return decodeURIComponent(value.join('='));
		} catch {
			return undefined;
		}
	}
	return undefined;
}

export function userFromToken(token: string | undefined): SessionUser | null {
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
