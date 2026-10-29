import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const createdAt = () =>
	integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`);

export const users = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	username: text('username').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	role: text('role', { enum: ['admin', 'user'] })
		.notNull()
		.default('user'),
	createdAt: createdAt()
});

export const sessions = sqliteTable('sessions', {
	// sha256 of the cookie token; the raw token is never stored
	id: text('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull()
});

export const instances = sqliteTable('instances', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	loader: text('loader', { enum: ['vanilla', 'paper', 'purpur'] }).notNull(),
	mcVersion: text('mc_version').notNull(),
	// Paper/Purpur build number; null for vanilla
	loaderVersion: text('loader_version'),
	port: integer('port').notNull().unique(),
	ramMinMb: integer('ram_min_mb').notNull().default(1024),
	ramMaxMb: integer('ram_max_mb').notNull().default(2048),
	// null = pick from the Minecraft version
	javaMajor: integer('java_major'),
	jvmArgs: text('jvm_args').notNull().default(''),
	autoStart: integer('auto_start', { mode: 'boolean' }).notNull().default(false),
	eulaAccepted: integer('eula_accepted', { mode: 'boolean' }).notNull().default(false),
	createdAt: createdAt()
});
