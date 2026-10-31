import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeInstance } from '#test/instance.js';
import { getProgress, runInstall, setProgress } from './install-progress';
import { runUpdate } from './instance-job';
import { getInstance, instanceDir } from './instances';
import { assertWritable, busyWith, claim } from './operations';
import { listAudit, setActorProvider } from './audit';
import { lastOutcome } from './update-outcome';

const opts = { kind: 'loader', backup: null } as const;

describe('runUpdate', () => {
	it('applies the columns, records the outcome and lets go of the instance', async () => {
		const row = makeInstance();
		let seen: { installing: boolean; claimed: string | null } | null = null;
		await runUpdate(row.id, opts, async ({ staging }) => {
			seen = {
				installing: getInstance(row.id)!.installState === 'installing',
				claimed: busyWith(row.id)
			};
			expect(existsSync(staging)).toBe(true);
			return { set: { mcVersion: '1.21.5' }, message: 'Updated', details: ['kept a.cfg'] };
		});
		expect(seen).toEqual({ installing: true, claimed: 'update' });
		expect(getInstance(row.id)).toMatchObject({ mcVersion: '1.21.5', installState: 'ready' });
		expect(lastOutcome(row.id)).toMatchObject({
			ok: true,
			message: 'Updated',
			details: ['kept a.cfg']
		});
		expect(busyWith(row.id)).toBeNull();
		expect(getProgress(row.id)).toBeNull();
		expect(existsSync(join(instanceDir(row.id), 'server.updating'))).toBe(false);
	});

	it('leaves the instance ready and untouched when it fails before the commit point', async () => {
		const row = makeInstance();
		await runUpdate(row.id, opts, async () => {
			throw new Error('download failed');
		});
		expect(getInstance(row.id)).toMatchObject({ installState: 'ready', mcVersion: row.mcVersion });
		expect(lastOutcome(row.id)).toMatchObject({ ok: false, message: 'download failed' });
		expect(busyWith(row.id)).toBeNull();
	});

	it('marks the instance failed when it fails after the commit point', async () => {
		const row = makeInstance();
		await runUpdate(row.id, opts, async ({ commit }) => {
			commit();
			throw new Error('disk full');
		});
		expect(getInstance(row.id)).toMatchObject({
			installState: 'failed',
			installMessage: 'disk full'
		});
		expect(lastOutcome(row.id)).toMatchObject({
			ok: false,
			message: 'The update stopped part way: disk full'
		});
		expect(busyWith(row.id)).toBeNull();
	});

	it('refuses an instance that is already busy, without changing it', () => {
		const row = makeInstance();
		const release = claim(row.id, 'backup');
		try {
			expect(() => runUpdate(row.id, opts, async () => ({ set: {}, message: '' }))).toThrow(
				/backup/
			);
			expect(getInstance(row.id)?.installState).toBe('ready');
		} finally {
			release();
		}
	});
});

describe('the audit log', () => {
	it('records how an update ended, credited to whoever started it', async () => {
		const row = makeInstance();
		setActorProvider(() => ({ id: 7, name: 'alex' }));
		const done = runUpdate(row.id, opts, async () => ({ set: {}, message: 'Updated to 1.21.5.' }));
		// the request is over by the time the update settles
		setActorProvider(() => null);
		await done;
		expect(listAudit({ instanceId: row.id })).toMatchObject([
			{ action: 'loader.update.done', summary: 'Updated to 1.21.5.', actorId: 7, actorName: 'alex' }
		]);
	});

	it('records a failure, with the same message the page shows', async () => {
		const row = makeInstance();
		await runUpdate(row.id, { kind: 'modpack', backup: null }, async ({ commit }) => {
			commit();
			throw new Error('disk full');
		});
		expect(listAudit({ instanceId: row.id })).toMatchObject([
			{
				action: 'modpack.update.failed',
				summary: 'Update failed: The update stopped part way: disk full',
				actorName: 'Panel'
			}
		]);
	});
});

describe('runInstall', () => {
	it('marks the instance ready and clears the progress', async () => {
		const row = makeInstance({ installState: 'installing' });
		setProgress(row.id, { label: 'Starting', done: 0, total: 1 });
		await runInstall(row, 'install', async () => {});
		expect(getInstance(row.id)).toMatchObject({ installState: 'ready', installMessage: null });
		expect(getProgress(row.id)).toBeNull();
	});

	it('marks the instance failed with the reason, cut to 500 characters', async () => {
		const row = makeInstance({ installState: 'installing' });
		await runInstall(row, 'install', async () => {
			throw new Error('x'.repeat(600));
		});
		const after = getInstance(row.id)!;
		expect(after.installState).toBe('failed');
		expect(after.installMessage).toHaveLength(500);
	});
});

describe('assertWritable', () => {
	it('allows an idle instance, refuses one being restored or installed', () => {
		const idle = makeInstance();
		expect(() => assertWritable(idle.id)).not.toThrow();

		const release = claim(idle.id, 'restore');
		expect(() => assertWritable(idle.id)).toThrow(/restore/);
		release();

		const installing = makeInstance({ installState: 'installing' });
		expect(() => assertWritable(installing.id)).toThrow(/install or update/);
	});

	it('lets a backup run beside writes, as it always could', () => {
		const row = makeInstance();
		const release = claim(row.id, 'backup');
		try {
			expect(() => assertWritable(row.id)).not.toThrow();
		} finally {
			release();
		}
	});
});
