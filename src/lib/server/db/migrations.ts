import { createHash } from 'node:crypto';

import journal from '../../../../drizzle/meta/_journal.json';

// The migrations are bundled into the server rather than read from a ./drizzle folder at run
// time, so a compiled binary carries them and starts from any working directory. This is what
// drizzle's own `readMigrationFiles` builds from the folder.
const files = import.meta.glob<string>('../../../../drizzle/*.sql', {
	query: '?raw',
	import: 'default',
	eager: true
});

export type EmbeddedMigration = {
	sql: string[];
	bps: boolean;
	folderMillis: number;
	hash: string;
};

export function embeddedMigrations(): EmbeddedMigration[] {
	return journal.entries.map((entry) => {
		const query = files[`../../../../drizzle/${entry.tag}.sql`];
		if (query === undefined) throw new Error(`Migration ${entry.tag} is missing from the build`);
		return {
			sql: query.split('--> statement-breakpoint'),
			bps: entry.breakpoints,
			folderMillis: entry.when,
			hash: createHash('sha256').update(query).digest('hex')
		};
	});
}
