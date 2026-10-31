import { eq } from 'drizzle-orm';

import { db } from './db';
import { settings } from './db/schema';

export function getSetting(key: string): string | undefined {
	return db.select().from(settings).where(eq(settings.key, key)).get()?.value;
}

export function setSetting(key: string, value: string) {
	db.insert(settings)
		.values({ key, value })
		.onConflictDoUpdate({ target: settings.key, set: { value } })
		.run();
}

export function deleteSetting(key: string) {
	db.delete(settings).where(eq(settings.key, key)).run();
}
