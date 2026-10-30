import { and, count, eq, ne } from 'drizzle-orm';
import { db } from './db';
import { roleAssignments, sessions, users } from './db/schema';

export type Role = 'admin' | 'user';

/** Every account, with how many role assignments each has. */
export function listUsers() {
	return db
		.select({
			id: users.id,
			username: users.username,
			role: users.role,
			createdAt: users.createdAt,
			assignments: count(roleAssignments.id)
		})
		.from(users)
		.leftJoin(roleAssignments, eq(roleAssignments.userId, users.id))
		.groupBy(users.id)
		.orderBy(users.username)
		.all();
}

const admins = () =>
	db.select({ n: count() }).from(users).where(eq(users.role, 'admin')).get()?.n ?? 0;

/** Stores an account with its password hashed. Kept apart from auth.ts, which needs the request. */
export async function createAccount(username: string, password: string, role: Role) {
	const passwordHash = await Bun.password.hash(password, 'argon2id');
	return db.insert(users).values({ username, passwordHash, role }).returning().get();
}

export async function addUser(username: string, password: string, role: Role) {
	if (db.select().from(users).where(eq(users.username, username)).get())
		throw new Error('That username is taken');
	const user = await createAccount(username, password, role);
	return { id: user.id, username: user.username, role: user.role };
}

/** Signs a user out everywhere, for when their password or role changes. */
const endSessions = (userId: number) =>
	db.delete(sessions).where(eq(sessions.userId, userId)).run();

export async function changeUser(
	userId: number,
	change: { role?: Role; password?: string },
	actorId: number
) {
	const user = db.select().from(users).where(eq(users.id, userId)).get();
	if (!user) throw new Error('User not found');
	if (change.role && change.role !== user.role) {
		if (user.role === 'admin' && admins() <= 1) throw new Error('There must be at least one admin');
		if (userId === actorId && change.role !== 'admin')
			throw new Error('You cannot take your own admin rights away');
		db.update(users).set({ role: change.role }).where(eq(users.id, userId)).run();
		// a changed role takes effect now, not at the next sign-in
		if (userId !== actorId) endSessions(userId);
	}
	if (change.password) {
		const passwordHash = await Bun.password.hash(change.password, 'argon2id');
		db.update(users).set({ passwordHash }).where(eq(users.id, userId)).run();
		// someone changing their own password stays signed in; anyone else is signed out everywhere
		if (userId !== actorId) endSessions(userId);
	}
}

export function removeUser(userId: number, actorId: number) {
	const user = db.select().from(users).where(eq(users.id, userId)).get();
	if (!user) throw new Error('User not found');
	if (userId === actorId) throw new Error('You cannot delete your own account');
	if (user.role === 'admin' && admins() <= 1) throw new Error('There must be at least one admin');
	// sessions and granted access go with the account (cascade)
	db.delete(users)
		.where(and(eq(users.id, userId), ne(users.id, actorId)))
		.run();
}
