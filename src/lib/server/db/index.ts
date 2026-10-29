import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { dataDir } from '../config';
import * as schema from './schema';

mkdirSync(dataDir, { recursive: true });

const sqlite = new Database(join(dataDir, 'panel.db'));
sqlite.run('PRAGMA journal_mode = WAL');
sqlite.run('PRAGMA foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

migrate(db, { migrationsFolder: './drizzle' });
