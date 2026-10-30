import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, ServerMessage } from '#runner/protocol.js';
import { makeInstance } from '#test/instance.js';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { instances } from './db/schema';

// The runner is replaced by a fake: whether the server runs, and what it logs in answer to a
// command, are decided per test.
const fake = vi.hoisted(() => ({
	running: false,
	sent: [] as string[],
	reply: {} as Record<string, string | null>,
	history: [] as string[],
	push: null as null | ((line: string) => void)
}));

vi.mock('./runner-client', () => ({
	status: async () =>
		fake.running ? { state: 'running', pid: 1, startedAt: 0, exitCode: null } : null,
	send: async (_dir: string, _id: number, msg: ClientMessage) => {
		if (msg.type !== 'stdin') return true;
		fake.sent.push(msg.line);
		const answer = fake.reply[msg.line];
		if (answer) setTimeout(() => fake.push?.(answer), 10);
		return true;
	},
	subscribe: async () => {
		let seq = 0;
		const queue: ServerMessage[] = fake.history.map((line) => ({ type: 'log', seq: ++seq, line }));
		let wake: (() => void) | null = null;
		let closed = false;
		fake.push = (line) => {
			queue.push({ type: 'log', seq: ++seq, line });
			wake?.();
		};
		return {
			async nextBatch() {
				while (!queue.length) {
					if (closed) return null;
					await new Promise<void>((resolve) => (wake = resolve));
				}
				return queue.splice(0);
			},
			close() {
				closed = true;
				wake?.();
			}
		};
	}
}));

const B = await import('./backups');
const { deleteInstance, getInstance, instanceDir, serverDir } = await import('./instances');

let id: number;
let root: string;
const put = (rel: string, content: string) => {
	mkdirSync(join(root, rel, '..'), { recursive: true });
	writeFileSync(join(root, rel), content);
};

beforeEach(() => {
	Object.assign(B.timing, { quietMs: 30, saveOffMs: 300, saveAllMs: 300 });
	Object.assign(fake, {
		running: false,
		sent: [],
		reply: {},
		history: [],
		push: null
	});
	id = makeInstance().id;
	root = serverDir(id);
	put('world/level.dat', 'level-v1');
	put('mods/a.jar', 'jar-a');
	put('server.properties', 'motd=one\n');
	put('logs/latest.log', 'old log line');
	put('crash-reports/crash.txt', 'boom');
});

const filesIn = (dir: string, base = dir): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? filesIn(join(dir, e.name), base) : [join(dir, e.name).slice(base.length + 1)]
	);

describe('parseExcludes', () => {
	it('reads one path per line and skips blanks and comments', () => {
		expect(B.parseExcludes('logs\n\n# note\n  cache/dumps \n')).toEqual(['logs', 'cache/dumps']);
	});

	it.each(['../x', '/etc', 'a\\b', 'C:x'])('refuses %j', (line) => {
		expect(() => B.parseExcludes(line)).toThrow(/not a path inside/);
	});
});

describe('createBackup', () => {
	it('zips the server folder without the excluded paths and records it', async () => {
		const row = await B.createBackup(id);
		expect(row).toMatchObject({ instanceId: id, kind: 'manual' });
		expect(row.size).toBeGreaterThan(0);
		expect(existsSync(B.backupPath(id, row.file))).toBe(true);
		expect(B.listBackups(id).map((b) => b.id)).toEqual([row.id]);

		const out = join(serverDir(id), '..', 'check');
		const { extractZip } = await import('./zip-extract');
		await extractZip(B.backupPath(id, row.file), out);
		expect(filesIn(out).sort()).toEqual(['mods/a.jar', 'server.properties', 'world/level.dat']);
		rmSync(out, { recursive: true });
	});

	it('leaves no partial file behind and lists newest first', async () => {
		const first = await B.createBackup(id);
		const second = await B.createBackup(id, { note: 'second' });
		expect(B.listBackups(id).map((b) => b.id)).toEqual([second.id, first.id]);
		expect(readdirSync(B.backupFolder(id)).some((f) => f.endsWith('.partial'))).toBe(false);
		expect(first.file).not.toBe(second.file);
	});

	it('refuses a second backup while one runs', async () => {
		const [a, b] = await Promise.allSettled([B.createBackup(id), B.createBackup(id)]);
		expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
		const failed = [a, b].find((r) => r.status === 'rejected') as PromiseRejectedResult;
		expect(String(failed.reason)).toMatch(/already running/);
	});

	it('refuses an instance that is still installing', async () => {
		db.update(instances).set({ installState: 'installing' }).where(eq(instances.id, id)).run();
		await expect(B.createBackup(id)).rejects.toThrow(/install/);
	});

	it('refuses an invalid exclude setting rather than backing up too much', async () => {
		db.update(instances).set({ backupExcludes: '../secret' }).where(eq(instances.id, id)).run();
		await expect(B.createBackup(id)).rejects.toThrow(/not a path inside/);
	});
});

describe('retention', () => {
	it('keeps the newest N manual backups and removes the rest with their files', async () => {
		db.update(instances).set({ backupKeep: 2 }).where(eq(instances.id, id)).run();
		const made = [];
		for (let i = 0; i < 4; i++) made.push(await B.createBackup(id));
		const left = B.listBackups(id);
		expect(left.map((b) => b.id)).toEqual([made[3].id, made[2].id]);
		expect(existsSync(B.backupPath(id, made[0].file))).toBe(false);
		expect(existsSync(B.backupPath(id, made[3].file))).toBe(true);
	});

	it('keeps everything when no limit is set', async () => {
		db.update(instances).set({ backupKeep: null }).where(eq(instances.id, id)).run();
		for (let i = 0; i < 3; i++) await B.createBackup(id);
		expect(B.listBackups(id)).toHaveLength(3);
	});
});

describe('deleteBackup', () => {
	it('removes the file and the record, only for its own instance', async () => {
		const row = await B.createBackup(id);
		expect(() => B.deleteBackup(makeInstance().id, row.id)).toThrow(/not found/);
		B.deleteBackup(id, row.id);
		expect(B.listBackups(id)).toEqual([]);
		expect(existsSync(B.backupPath(id, row.file))).toBe(false);
	});
});

describe('restoreBackup', () => {
	it('puts the saved files back, drops later ones and keeps the excluded paths', async () => {
		const row = await B.createBackup(id);
		put('world/level.dat', 'level-v2');
		put('mods/b.jar', 'jar-b');
		rmSync(join(root, 'mods', 'a.jar'));
		put('logs/latest.log', 'newer log');

		await B.restoreBackup(id, row.id);

		expect(readFileSync(join(root, 'world/level.dat'), 'utf8')).toBe('level-v1');
		expect(existsSync(join(root, 'mods/a.jar'))).toBe(true);
		expect(existsSync(join(root, 'mods/b.jar'))).toBe(false);
		expect(readFileSync(join(root, 'logs/latest.log'), 'utf8')).toBe('newer log');
		expect(existsSync(`${root}.restoring`)).toBe(false);
		expect(existsSync(`${root}.replaced`)).toBe(false);
	});

	it('first backs up what it replaces, and that one is never pruned', async () => {
		db.update(instances).set({ backupKeep: 1 }).where(eq(instances.id, id)).run();
		const row = await B.createBackup(id);
		put('world/level.dat', 'level-v2');
		await B.restoreBackup(id, row.id);
		await B.createBackup(id);
		const kinds = B.listBackups(id).map((b) => b.kind);
		expect(kinds).toContain('before-restore');
		expect(kinds.filter((k) => k === 'manual')).toHaveLength(1);
	});

	it('refuses while the server runs, and changes nothing', async () => {
		const row = await B.createBackup(id);
		put('world/level.dat', 'level-v2');
		fake.running = true;
		await expect(B.restoreBackup(id, row.id)).rejects.toThrow(/Stop the server/);
		expect(readFileSync(join(root, 'world/level.dat'), 'utf8')).toBe('level-v2');
	});

	it('leaves the server untouched when the archive is damaged', async () => {
		const row = await B.createBackup(id);
		writeFileSync(B.backupPath(id, row.file), 'not a zip file at all, just text '.repeat(5));
		put('world/level.dat', 'level-v2');
		await expect(B.restoreBackup(id, row.id)).rejects.toThrow();
		expect(readFileSync(join(root, 'world/level.dat'), 'utf8')).toBe('level-v2');
		expect(existsSync(`${root}.restoring`)).toBe(false);
	});

	it('recovers a server whose update failed, making it ready again', async () => {
		const row = await B.createBackup(id);
		writeFileSync(join(instanceDir(id), 'instance.json'), '{}');
		db.update(instances)
			.set({ installState: 'failed', installMessage: 'The update stopped part way' })
			.where(eq(instances.id, id))
			.run();
		put('world/level.dat', 'level-v2');
		await B.restoreBackup(id, row.id);
		expect(readFileSync(join(root, 'world/level.dat'), 'utf8')).toBe('level-v1');
		expect(getInstance(id)).toMatchObject({ installState: 'ready', installMessage: null });
	});

	it('refuses an install that never finished, which has nothing to restore into', async () => {
		const row = await B.createBackup(id);
		db.update(instances).set({ installState: 'failed' }).where(eq(instances.id, id)).run();
		await expect(B.restoreBackup(id, row.id)).rejects.toThrow(/install failed/);
	});

	it('reports a backup whose file is gone', async () => {
		const row = await B.createBackup(id);
		rmSync(B.backupPath(id, row.file));
		await expect(B.restoreBackup(id, row.id)).rejects.toThrow(/missing/);
	});
});

describe('backing up a running server', () => {
	it('pauses autosave, flushes, copies, then turns autosave back on, in that order', async () => {
		fake.running = true;
		fake.reply = {
			'save-off': '[12:00:00] [Server thread/INFO]: Automatic saving is now disabled',
			'save-all flush': '[12:00:01] [Server thread/INFO]: Saved the game'
		};
		await B.createBackup(id);
		expect(fake.sent).toEqual(['save-off', 'save-all flush', 'save-on']);
	});

	it('ignores confirmations that were already in the log before the backup began', async () => {
		fake.running = true;
		fake.history = [
			'[11:00:00] [Server thread/INFO]: Automatic saving is now disabled',
			'[11:00:01] [Server thread/INFO]: Saved the game'
		];
		fake.reply = { 'save-off': null };
		await expect(B.createBackup(id)).rejects.toThrow(/did not confirm it paused saving/);
		expect(fake.sent).toEqual(['save-off', 'save-on']);
	});

	it('turns autosave back on even when the world never finished saving', async () => {
		fake.running = true;
		fake.reply = {
			'save-off': '[12:00:00] [Server thread/INFO]: Automatic saving is now disabled',
			'save-all flush': null
		};
		await expect(B.createBackup(id)).rejects.toThrow(/did not finish saving/);
		expect(fake.sent).toEqual(['save-off', 'save-all flush', 'save-on']);
		expect(B.listBackups(id)).toEqual([]);
	});
});

describe('instance deletion', () => {
	it('removes the instance backups folder too', async () => {
		await B.createBackup(id);
		expect(existsSync(B.backupFolder(id))).toBe(true);
		await deleteInstance(id);
		expect(existsSync(B.backupFolder(id))).toBe(false);
	});
});
