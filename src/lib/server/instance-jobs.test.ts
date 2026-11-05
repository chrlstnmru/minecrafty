import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { makeInstance } from '#test/instance.js';
import { holdJob } from '#test/jobs.js';

import { listAudit, setActorProvider } from './audit';
import {
	assertWritable,
	check,
	holdStart,
	jobState,
	recoverInterruptedJobs,
	run,
	start,
	wasInstalled
} from './instance-jobs';
import { getInstance, instanceDir } from './instances';

const audit = { audit: 'loader' } as const;

describe('an update', () => {
	it('applies the columns, records the outcome and lets go of the instance', async () => {
		const row = makeInstance();
		let seen: { installing: boolean; job: string | null; staging: boolean } | null = null;
		const { finished } = await start(
			row.id,
			'update',
			async ({ staging }) => {
				seen = {
					installing: getInstance(row.id)!.installState === 'installing',
					job: jobState(row.id).job,
					staging: existsSync(staging())
				};
				return { set: { mcVersion: '1.21.5' }, message: 'Updated', details: ['kept a.cfg'] };
			},
			audit
		);
		await finished;
		expect(seen).toEqual({ installing: true, job: 'update', staging: true });
		expect(getInstance(row.id)).toMatchObject({ mcVersion: '1.21.5', installState: 'ready' });
		expect(jobState(row.id)).toMatchObject({
			job: null,
			progress: null,
			outcome: { ok: true, message: 'Updated', details: ['kept a.cfg'] }
		});
		expect(existsSync(join(instanceDir(row.id), 'server.updating'))).toBe(false);
		expect(wasInstalled(row.id)).toBe(true);
	});

	it('makes no staging folder unless the steps ask for one', async () => {
		const row = makeInstance();
		let made = false;
		const { finished } = await start(
			row.id,
			'update',
			async () => {
				made = existsSync(join(instanceDir(row.id), 'server.updating'));
				return { set: {}, message: 'Updated' };
			},
			audit
		);
		await finished;
		expect(made).toBe(false);
	});

	it('leaves the instance ready and untouched when it fails before the commit point', async () => {
		const row = makeInstance();
		const { finished } = await start(
			row.id,
			'update',
			async () => {
				throw new Error('download failed');
			},
			audit
		);
		await finished;
		expect(getInstance(row.id)).toMatchObject({ installState: 'ready', mcVersion: row.mcVersion });
		expect(jobState(row.id)).toMatchObject({
			job: null,
			outcome: { ok: false, message: 'download failed' }
		});
	});

	it('marks the instance failed when it fails after the commit point', async () => {
		const row = makeInstance();
		const { finished } = await start(
			row.id,
			'update',
			async ({ commit }) => {
				commit();
				throw new Error('disk full');
			},
			audit
		);
		await finished;
		expect(getInstance(row.id)).toMatchObject({
			installState: 'failed',
			installMessage: 'disk full'
		});
		expect(jobState(row.id).outcome).toMatchObject({
			ok: false,
			message: 'The update stopped part way: disk full'
		});
	});

	it('refuses an instance that is busy, without changing it', async () => {
		const row = makeInstance();
		const letGo = await holdJob(row.id, 'backup');
		try {
			await expect(
				start(row.id, 'update', async () => ({ set: {}, message: '' }), audit)
			).rejects.toThrow('A backup is already running');
			expect(getInstance(row.id)?.installState).toBe('ready');
		} finally {
			await letGo();
		}
	});

	it('lets only one of two updates started together through', async () => {
		const row = makeInstance();
		const work = async () => ({ set: {}, message: 'Updated' });
		const [first, second] = await Promise.allSettled([
			start(row.id, 'update', work, audit),
			start(row.id, 'update', work, audit)
		]);
		expect(first.status).toBe('fulfilled');
		expect(second).toMatchObject({
			status: 'rejected',
			reason: { message: 'An update is in progress. Try again when it finishes.' }
		});
		if (first.status === 'fulfilled') await first.value.finished;
	});

	it('refuses an instance whose install failed', async () => {
		const row = makeInstance({ installState: 'failed', installMessage: 'boom' });
		await expect(
			start(row.id, 'update', async () => ({ set: {}, message: '' }), audit)
		).rejects.toThrow('The install failed: boom');
		expect(jobState(row.id).job).toBeNull();
	});
});

describe('the audit log', () => {
	it('records how an update ended, credited to whoever started it', async () => {
		const row = makeInstance();
		setActorProvider(() => ({ id: 7, name: 'alex' }));
		const started = start(
			row.id,
			'update',
			async () => ({ set: {}, message: 'Updated to 1.21.5.' }),
			audit
		);
		// the request is over by the time the update settles
		setActorProvider(() => null);
		await (
			await started
		).finished;
		expect(listAudit({ instanceId: row.id })).toMatchObject([
			{ action: 'loader.update.done', summary: 'Updated to 1.21.5.', actorId: 7, actorName: 'alex' }
		]);
	});

	it('records a failure, with the same message the page shows', async () => {
		const row = makeInstance();
		const { finished } = await start(
			row.id,
			'update',
			async ({ commit }) => {
				commit();
				throw new Error('disk full');
			},
			{ audit: 'modpack' }
		);
		await finished;
		expect(listAudit({ instanceId: row.id })).toMatchObject([
			{
				action: 'modpack.update.failed',
				summary: 'Update failed: The update stopped part way: disk full',
				actorName: 'Panel'
			}
		]);
	});
});

describe('an install', () => {
	it('shows as installing with progress, then becomes ready with instance.json', async () => {
		const row = makeInstance();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const { row: installing, finished } = await start(row.id, 'install', async ({ progress }) => {
			progress('Downloading the server', { done: 10, total: 50, bytes: true });
			await gate;
		});
		expect(installing.installState).toBe('installing');
		expect(jobState(row.id)).toMatchObject({
			job: 'install',
			progress: { label: 'Downloading the server', done: 10, total: 50, bytes: true }
		});
		expect(() => assertWritable(row.id)).toThrow(/install or update/);
		release();
		await finished;
		expect(getInstance(row.id)).toMatchObject({ installState: 'ready', installMessage: null });
		expect(jobState(row.id)).toEqual({ job: null, progress: null, outcome: null });
		expect(
			JSON.parse(readFileSync(join(instanceDir(row.id), 'instance.json'), 'utf8'))
		).toMatchObject({
			mcVersion: row.mcVersion
		});
	});

	it('marks the instance failed with the reason, cut to 500 characters', async () => {
		const row = makeInstance();
		const { finished } = await start(row.id, 'install', async () => {
			throw new Error('x'.repeat(600));
		});
		await finished;
		const after = getInstance(row.id)!;
		expect(after.installState).toBe('failed');
		expect(after.installMessage).toHaveLength(500);
		expect(wasInstalled(row.id)).toBe(false);
	});

	it('keeps backups and restores off the instance while it runs', async () => {
		const row = makeInstance();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const { finished } = await start(row.id, 'install', () => gate);
		await expect(run(row.id, 'backup', async () => {})).rejects.toThrow(
			'Wait for the install to finish'
		);
		release();
		await finished;
	});
});

describe('a backup or restore', () => {
	it('returns what the work returns and lets go of the instance', async () => {
		const row = makeInstance();
		await expect(run(row.id, 'backup', async () => 42)).resolves.toBe(42);
		expect(jobState(row.id).job).toBeNull();
	});

	it('rejects as the work does and still lets go', async () => {
		const row = makeInstance();
		await expect(
			run(row.id, 'restore', async () => {
				throw new Error('bad zip');
			})
		).rejects.toThrow('bad zip');
		expect(jobState(row.id).job).toBeNull();
	});

	it('a restore makes a failed update ready again; a backup needs a finished install', async () => {
		const row = makeInstance({ installState: 'failed', installMessage: 'stopped part way' });
		writeFileSync(join(instanceDir(row.id), 'instance.json'), '{}');
		await expect(run(row.id, 'backup', async () => {})).rejects.toThrow(/The install failed/);
		await run(row.id, 'restore', async () => {});
		expect(getInstance(row.id)).toMatchObject({ installState: 'ready', installMessage: null });
	});

	it('a restore refuses a server that was never installed', async () => {
		const row = makeInstance({ installState: 'failed' });
		await expect(run(row.id, 'restore', async () => {})).rejects.toThrow(
			'The install failed, so there is nothing to restore into'
		);
	});
});

describe('check', () => {
	it('lets a server start during a backup, but not during a restore', async () => {
		const row = makeInstance();
		let letGo = await holdJob(row.id, 'backup');
		await expect(check(row.id, 'start')).resolves.toMatchObject({ id: row.id });
		await letGo();

		letGo = await holdJob(row.id, 'restore');
		await expect(check(row.id, 'start')).rejects.toThrow('A restore is in progress');
		await letGo();
	});

	it('refuses deleting an instance while a backup runs', async () => {
		const row = makeInstance();
		const letGo = await holdJob(row.id, 'backup');
		await expect(check(row.id, 'delete')).rejects.toThrow('A backup is already running');
		await letGo();
	});

	it('says an instance is not found', async () => {
		await expect(check(999_999, 'start')).rejects.toThrow('Instance not found');
	});
});

describe('a refusal', () => {
	it.each([
		['backup', 'A backup is already running. Try again when it finishes.'],
		['restore', 'A restore is in progress. Try again when it finishes.'],
		['write', 'Files are being added to this server. Try again when that finishes.']
	] as const)('during a %s says what to do', async (kind, message) => {
		const row = makeInstance();
		const letGo = await holdJob(row.id, kind);
		await expect(run(row.id, 'backup', async () => {})).rejects.toThrow(message);
		await expect(check(row.id, 'delete')).rejects.toThrow(message);
		await letGo();
	});
});

describe('a write', () => {
	const refused = 'Files are being added to this server';

	it('refuses other jobs and a second write until it finishes', async () => {
		const row = makeInstance();
		const letGo = await holdJob(row.id, 'write');
		await expect(run(row.id, 'write', async () => {})).rejects.toThrow(
			`${refused}. Try again when that finishes.`
		);
		await expect(run(row.id, 'backup', async () => {})).rejects.toThrow(refused);
		await expect(run(row.id, 'restore', async () => {})).rejects.toThrow(refused);
		await expect(start(row.id, 'install', async () => {})).rejects.toThrow(refused);
		await expect(check(row.id, 'update')).rejects.toThrow(refused);
		await expect(check(row.id, 'delete')).rejects.toThrow(refused);
		await letGo();
		await expect(run(row.id, 'write', async () => 'done')).resolves.toBe('done');
	});

	it('says to try again when a backup is running', async () => {
		const row = makeInstance();
		const letGo = await holdJob(row.id, 'backup');
		await expect(run(row.id, 'write', async () => {})).rejects.toThrow(
			'A backup is already running. Try again when it finishes.'
		);
		await letGo();
	});

	it('does not stop a start or a quick change to the server folder', async () => {
		const row = makeInstance();
		const letGo = await holdJob(row.id, 'write');
		await expect(check(row.id, 'start')).resolves.toMatchObject({ id: row.id });
		expect(() => assertWritable(row.id)).not.toThrow();
		await letGo();
	});

	it('reports progress while it runs, and drops it after', async () => {
		const row = makeInstance();
		await run(row.id, 'write', async (_, { progress }) => {
			progress('Downloading Sodium', { done: 2, total: 8, bytes: true });
			expect(jobState(row.id)).toMatchObject({
				job: 'write',
				progress: { label: 'Downloading Sodium', done: 2, total: 8, bytes: true }
			});
		});
		expect(jobState(row.id)).toMatchObject({ job: null, progress: null });
	});
});

describe('a start', () => {
	function holdStarting(id: number) {
		const { promise, resolve } = Promise.withResolvers<void>();
		const started = holdStart(id, () => promise);
		return async () => {
			resolve();
			await started;
		};
	}

	it('refuses a second start, and what would change the server folder under it', async () => {
		const row = makeInstance();
		const letGo = holdStarting(row.id);
		const refused = 'The server is already starting';

		await expect(holdStart(row.id, async () => {})).rejects.toThrow(refused);
		await expect(check(row.id, 'update')).rejects.toThrow(refused);
		await expect(check(row.id, 'delete')).rejects.toThrow(refused);
		await expect(run(row.id, 'restore', async () => {})).rejects.toThrow(refused);
		await expect(start(row.id, 'install', async () => {})).rejects.toThrow(refused);
		await letGo();
	});

	it('leaves a backup alone, and can begin during one', async () => {
		const row = makeInstance();
		const letGo = holdStarting(row.id);
		await expect(run(row.id, 'backup', async () => 'saved')).resolves.toBe('saved');
		await letGo();

		const release = await holdJob(row.id, 'backup');
		await expect(holdStart(row.id, async () => 'up')).resolves.toBe('up');
		await release();
	});

	it('gives the instance back when it fails', async () => {
		const row = makeInstance();
		await expect(
			holdStart(row.id, async () => {
				throw new Error('no Java');
			})
		).rejects.toThrow('no Java');
		await expect(holdStart(row.id, async () => 'up')).resolves.toBe('up');
	});

	it('gives the instance back when its checks refuse it', async () => {
		const row = makeInstance({ installState: 'failed' });
		await expect(holdStart(row.id, async () => {})).rejects.toThrow(/install failed/);
		await expect(check(row.id, 'delete')).resolves.toMatchObject({ id: row.id });
	});
});

describe('assertWritable', () => {
	it('allows an idle instance, refuses one being restored or installed', async () => {
		const idle = makeInstance();
		expect(() => assertWritable(idle.id)).not.toThrow();

		const letGo = await holdJob(idle.id, 'restore');
		expect(() => assertWritable(idle.id)).toThrow(/restore/);
		await letGo();

		const installing = makeInstance({ installState: 'installing' });
		expect(() => assertWritable(installing.id)).toThrow(/install or update/);
	});

	it('lets a backup run beside writes, as it always could', async () => {
		const row = makeInstance();
		const letGo = await holdJob(row.id, 'backup');
		try {
			expect(() => assertWritable(row.id)).not.toThrow();
		} finally {
			await letGo();
		}
	});
});

describe('recoverInterruptedJobs', () => {
	it('marks an install interrupted by a restart as failed', () => {
		const stuck = makeInstance({ installState: 'installing' });
		const fine = makeInstance();
		recoverInterruptedJobs();
		expect(getInstance(stuck.id)).toMatchObject({
			installState: 'failed',
			installMessage: 'Interrupted by a panel restart'
		});
		expect(getInstance(fine.id)?.installState).toBe('ready');
	});
});
