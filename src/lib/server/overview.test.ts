import { beforeEach, describe, expect, it } from 'vitest';

import { makeInstance } from '#test/instance.js';

import { db } from './db';
import { backups, instances, schedules } from './db/schema';
import { overview } from './overview';

const at = (h: number, m = 0) => new Date(2026, 9, 30, h, m, 0);

beforeEach(() => {
	db.delete(schedules).run();
	db.delete(backups).run();
	db.delete(instances).run();
});

const backup = (instanceId: number, createdAt: Date) =>
	db
		.insert(backups)
		.values({ instanceId, file: `${createdAt.getTime()}.zip`, size: 1, createdAt })
		.run();
const task = (instanceId: number, name: string, cron: string, enabled = true) =>
	db.insert(schedules).values({ instanceId, name, cron, action: 'backup', enabled }).run();

describe('overview', () => {
	it('is empty on a fresh panel', () => {
		expect(overview(at(12))).toEqual({ lastBackup: null, withoutBackup: 0, nextTask: null });
	});

	it('names the newest backup and counts servers that have none', () => {
		const a = makeInstance({ name: 'Alpha' }).id;
		const b = makeInstance({ name: 'Beta' }).id;
		makeInstance({ name: 'Gamma' });
		backup(a, new Date(2026, 9, 28));
		backup(b, new Date(2026, 9, 29));
		backup(a, new Date(2026, 9, 27));
		const result = overview(at(12));
		expect(result.lastBackup).toEqual({
			at: new Date(2026, 9, 29).getTime(),
			instanceName: 'Beta'
		});
		expect(result.withoutBackup).toBe(1);
	});

	it('finds the soonest task across servers, ignoring ones switched off or unreadable', () => {
		const a = makeInstance({ name: 'Alpha' }).id;
		const b = makeInstance({ name: 'Beta' }).id;
		task(a, 'Late', '0 22 * * *');
		task(b, 'Soon', '30 13 * * *');
		task(b, 'Off', '0 12 * * *', false);
		task(a, 'Broken', 'nonsense');
		const next = overview(at(12)).nextTask!;
		expect(next).toMatchObject({ name: 'Soon', instanceId: b, instanceName: 'Beta' });
		expect(next.at).toBe(at(13, 30).getTime());
	});

	it('has no next task when every task is switched off', () => {
		task(makeInstance().id, 'Off', '0 12 * * *', false);
		expect(overview(at(12)).nextTask).toBeNull();
	});
});
