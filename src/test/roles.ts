import type { Permission } from '#lib/permissions.js';

import { db } from '#lib/server/db/index.js';
import { roles } from '#lib/server/db/schema.js';

/** Inserts a role directly, at the rank given, for tests that need roles of known ranks. */
export function makeRole(name: string, rank: number, allow: Permission[]) {
	return db
		.insert(roles)
		.values({ name, rank, rules: JSON.stringify({ allow }) })
		.returning()
		.get().id;
}
