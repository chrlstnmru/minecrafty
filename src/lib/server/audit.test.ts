import { beforeEach, describe, expect, it } from 'vitest';
import { makeInstance } from '#test/instance.js';
import { AUDIT_LIMIT, listAudit, pruneAudit, record, setActorProvider } from './audit';
import { db } from './db';
import { auditLog, instances } from './db/schema';

beforeEach(() => {
	db.delete(auditLog).run();
	db.delete(instances).run();
	setActorProvider(() => null);
});

describe('record', () => {
	it('writes who did what, with the instance name copied in', () => {
		const inst = makeInstance({ name: 'Survival' });
		setActorProvider(() => ({ id: 7, name: 'alice' }));
		record({ action: 'instance.start', summary: 'Started the server', instanceId: inst.id });
		expect(listAudit()).toMatchObject([
			{
				actorId: 7,
				actorName: 'alice',
				action: 'instance.start',
				instanceId: inst.id,
				instanceName: 'Survival',
				summary: 'Started the server'
			}
		]);
	});

	it('attributes an action with no request to the panel itself', () => {
		record({ action: 'schedule.run', summary: 'Ran a task' });
		expect(listAudit()[0]).toMatchObject({ actorId: null, actorName: 'Panel' });
	});

	it('takes an actor given outright, and keeps the name after the instance is deleted', () => {
		const inst = makeInstance({ name: 'Old' });
		record({ action: 'a', summary: 's', instanceId: inst.id }, { id: 1, name: 'bob' });
		db.delete(instances).run();
		expect(listAudit()[0]).toMatchObject({ actorName: 'bob', instanceName: 'Old' });
	});

	it('never throws, even when the provider does or the write fails', () => {
		setActorProvider(() => {
			throw new Error('no request');
		});
		expect(() => record({ action: 'a', summary: 's' })).not.toThrow();
		expect(listAudit()[0].actorName).toBe('Panel');
		expect(() =>
			record({ action: 'a', summary: 's' }, { id: 1, name: null as never })
		).not.toThrow();
	});

	it('cuts a very long summary', () => {
		record({ action: 'a', summary: 'x'.repeat(2000) });
		expect(listAudit()[0].summary).toHaveLength(500);
	});
});

describe('listAudit', () => {
	it('lists newest first, for one instance or all, up to a limit', () => {
		const one = makeInstance({ name: 'One' });
		const two = makeInstance({ name: 'Two' });
		for (const [i, inst] of [one, two, one].entries())
			record({ action: 'a', summary: `n${i}`, instanceId: inst.id }, { id: 1, name: 'x' });
		expect(listAudit().map((r) => r.summary)).toEqual(['n2', 'n1', 'n0']);
		expect(listAudit({ instanceId: one.id }).map((r) => r.summary)).toEqual(['n2', 'n0']);
		expect(listAudit({ limit: 1 })).toHaveLength(1);
		expect(AUDIT_LIMIT).toBe(1000);
	});
});

describe('pruneAudit', () => {
	it('drops entries older than the retention and keeps newer ones', () => {
		const day = 24 * 60 * 60 * 1000;
		db.insert(auditLog)
			.values([
				{ at: new Date(Date.now() - 200 * day), actorName: 'x', action: 'old', summary: 'old' },
				{ at: new Date(Date.now() - 10 * day), actorName: 'x', action: 'new', summary: 'new' }
			])
			.run();
		expect(pruneAudit()).toBe(1);
		expect(listAudit().map((r) => r.action)).toEqual(['new']);
	});
});
