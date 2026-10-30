import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
	loader: text('loader', {
		enum: ['vanilla', 'paper', 'purpur', 'fabric', 'quilt', 'forge', 'neoforge']
	}).notNull(),
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
	// a modpack import installs in the background; the instance cannot start until it is ready
	installState: text('install_state', { enum: ['ready', 'installing', 'failed'] })
		.notNull()
		.default('ready'),
	installMessage: text('install_message'),
	// set for an instance created from a Modrinth modpack, so it can be updated from that pack
	packProjectId: text('pack_project_id'),
	packVersionId: text('pack_version_id'),
	packVersionNumber: text('pack_version_number'),
	packName: text('pack_name'),
	packIconUrl: text('pack_icon_url'),
	// RCON, which the panel enables on every start to run commands and read the player list; the
	// password is generated once and never leaves the server side
	rconPort: integer('rcon_port'),
	rconPassword: text('rcon_password'),
	// how many backups to keep, oldest removed first; null keeps them all
	backupKeep: integer('backup_keep').default(5),
	// paths left out of a backup, one per line, relative to the server folder
	backupExcludes: text('backup_excludes').notNull().default('logs\ncrash-reports'),
	createdAt: createdAt()
});

// mods, plugins and the server resource pack installed from a mod platform
export const installedMods = sqliteTable(
	'installed_mods',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		instanceId: integer('instance_id')
			.notNull()
			.references(() => instances.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: ['mod', 'resourcepack'] })
			.notNull()
			.default('mod'),
		source: text('source', { enum: ['modrinth', 'curseforge'] }).notNull(),
		projectId: text('project_id').notNull(),
		versionId: text('version_id').notNull(),
		title: text('title').notNull(),
		iconUrl: text('icon_url'),
		versionNumber: text('version_number').notNull(),
		// where the project says it runs: required, optional or unsupported; null until known
		clientSide: text('client_side'),
		serverSide: text('server_side'),
		// path relative to the instance's server folder, e.g. mods/sodium-0.6.jar; empty for
		// server resource packs, which are referenced by `url` instead of stored on the host
		file: text('file').notNull(),
		url: text('url'),
		// sha512 of the installed file, to spot manual changes and match updates
		hash: text('hash'),
		// project id of the mod that pulled this one in as a required dependency
		dependencyOf: text('dependency_of'),
		installedAt: integer('installed_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		uniqueIndex('installed_mods_project').on(t.instanceId, t.kind, t.source, t.projectId),
		index('installed_mods_instance').on(t.instanceId)
	]
);

// zip backups of an instance; the file sits in backups/<instance id>/
export const backups = sqliteTable(
	'backups',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		instanceId: integer('instance_id')
			.notNull()
			.references(() => instances.id, { onDelete: 'cascade' }),
		file: text('file').notNull(),
		size: integer('size').notNull(),
		// manual and scheduled backups are pruned by the retention setting; the others are kept
		kind: text('kind', { enum: ['manual', 'scheduled', 'before-restore', 'before-update'] })
			.notNull()
			.default('manual'),
		note: text('note'),
		createdAt: createdAt()
	},
	(t) => [index('backups_instance').on(t.instanceId)]
);

// panel-wide key/value settings (public URL, later the CurseForge API key)
export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});
