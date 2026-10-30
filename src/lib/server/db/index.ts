import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { dataDir } from '../config';
import { embeddedMigrations } from './migrations';
import * as schema from './schema';

mkdirSync(dataDir, { recursive: true });

const sqlite = new Database(join(dataDir, 'panel.db'));
sqlite.run('PRAGMA journal_mode = WAL');
sqlite.run('PRAGMA foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

// the same as drizzle's `migrate`, with the migrations from the bundle instead of a folder
const internals = db as unknown as {
	dialect: {
		migrate(migrations: unknown, session: unknown, config: { migrationsFolder: string }): void;
	};
	session: unknown;
};
internals.dialect.migrate(embeddedMigrations(), internals.session, {
	migrationsFolder: 'embedded'
});
