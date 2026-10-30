import { and, count, eq, ne } from 'drizzle-orm';
import { db } from './db';
import { roleAssignments, sessions, users } from './db/schema';

export type Role = 'owner' | 'user';

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

/** Stores an account with its password hashed. Kept apart from auth.ts, which needs the request. There is only ever one owner: the account made at setup. */
export async function createAccount(username: string, password: string, role: Role) {
	if (role === 'owner' && db.select().from(users).where(eq(users.role, 'owner')).get())
		throw new Error('There is already an owner');
	const passwordHash = await Bun.password.hash(password, 'argon2id');
	return db.insert(users).values({ username, passwordHash, role }).returning().get();
}

/** Adds a plain user, who can do nothing until they are given a role. */
export async function addUser(username: string, password: string) {
	if (db.select().from(users).where(eq(users.username, username)).get())
		throw new Error('That username is taken');
	const user = await createAccount(username, password, 'user');
	return { id: user.id, username: user.username, role: user.role };
}

/** Signs a user out everywhere, for when their password changes. */
const endSessions = (userId: number) =>
	db.delete(sessions).where(eq(sessions.userId, userId)).run();

export async function changeUser(userId: number, change: { password: string }, actorId: number) {
	const user = db.select().from(users).where(eq(users.id, userId)).get();
	if (!user) throw new Error('User not found');
	const passwordHash = await Bun.password.hash(change.password, 'argon2id');
	db.update(users).set({ passwordHash }).where(eq(users.id, userId)).run();
	// someone changing their own password stays signed in; anyone else is signed out everywhere
	if (userId !== actorId) endSessions(userId);
}

export function removeUser(userId: number, actorId: number) {
	const user = db.select().from(users).where(eq(users.id, userId)).get();
	if (!user) throw new Error('User not found');
	if (userId === actorId) throw new Error('You cannot delete your own account');
	if (user.role === 'owner') throw new Error('The owner cannot be deleted');
	// sessions and granted access go with the account (cascade)
	db.delete(users)
		.where(and(eq(users.id, userId), ne(users.id, actorId)))
		.run();
}
