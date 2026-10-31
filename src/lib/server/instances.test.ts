import { eq } from 'drizzle-orm';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { makeInstance } from '#test/instance.js';

import { db } from './db';
import { instances } from './db/schema';
import { setProgress, clearProgress } from './install-progress';
import * as I from './instances';
import { claim } from './operations';

describe('ports', () => {
	it('suggests the first free port from 25565 upward', () => {
		const taken = makeInstance({ port: I.PORT_START });
		const next = I.nextFreePort();
		expect(next).toBeGreaterThan(I.PORT_START);
		expect(I.getInstance(taken.id)?.port).toBe(I.PORT_START);
		// the suggestion is really free
		expect(() => makeInstance({ port: next })).not.toThrow();
	});

	it('refuses two instances on one port', () => {
		makeInstance({ port: 27001, name: 'First' });
		expect(() => makeInstance({ port: 27001 })).toThrow('Port 27001 is used by First');
	});

	it('skips RCON ports, and refuses a game port that is one', () => {
		const a = makeInstance({ port: 27100, name: 'Alpha' });
		// RCON on the port that would be suggested next
		const rcon = I.nextFreePort();
		db.update(instances)
			.set({ rconPort: rcon, rconPassword: 'x' })
			.where(eq(instances.id, a.id))
			.run();
		expect(I.nextFreePort()).not.toBe(rcon);

		expect(() => makeInstance({ port: rcon })).toThrow(`Port ${rcon} is the RCON port of Alpha`);
		const b = makeInstance({ port: 27101 });
		expect(() => I.updateSettings(b.id, { ...I.getInstance(b.id)!, port: rcon })).toThrow(
			/RCON port of Alpha/
		);
		expect(() => I.updateSettings(a.id, { ...I.getInstance(a.id)!, port: rcon })).toThrow(
			"this server's RCON port"
		);
		expect(I.portConflict(new I.PortTakenError('x'))).toBe('x');
		expect(I.portConflict(new Error('boom'))).toBeNull();
	});
});

describe('creating an instance row', () => {
	it('creates its server folder and starts out ready', () => {
		const row = makeInstance();
		expect(existsSync(I.serverDir(row.id))).toBe(true);
		expect(row.installState).toBe('ready');
		expect(row.installMessage).toBeNull();
	});

	it('discarding removes the row and the folder', () => {
		const row = makeInstance();
		I.discardInstance(row.id);
		expect(I.getInstance(row.id)).toBeUndefined();
		expect(existsSync(I.instanceDir(row.id))).toBe(false);
	});
});

describe('settings', () => {
	it('saves what the settings page edits and leaves the rest', () => {
		const row = makeInstance({ name: 'old' });
		I.updateSettings(row.id, {
			name: 'new',
			port: 27050,
			ramMinMb: 256,
			ramMaxMb: 2048,
			javaMajor: 21,
			jvmArgs: '-XX:+UseG1GC',
			autoStart: true
		});
		expect(I.getInstance(row.id)).toMatchObject({
			name: 'new',
			port: 27050,
			ramMaxMb: 2048,
			javaMajor: 21,
			autoStart: true,
			loader: 'vanilla'
		});
	});
});

describe('unfinished installs', () => {
	it('cannot start while installing, or after a failed install', async () => {
		const installing = makeInstance({ installState: 'installing' });
		await expect(I.startInstance(installing.id)).rejects.toThrow(/Still installing/);
		const failed = makeInstance({
			installState: 'failed',
			installMessage: 'a mod could not be downloaded'
		});
		await expect(I.startInstance(failed.id)).rejects.toThrow(
			/install failed: a mod could not be downloaded/
		);
	});

	it('cannot be deleted while installing', async () => {
		const row = makeInstance({ installState: 'installing' });
		await expect(I.deleteInstance(row.id)).rejects.toThrow(/Wait for the install/);
		expect(I.getInstance(row.id)).toBeDefined();
	});

	it('a failed install can be deleted', async () => {
		const row = makeInstance({ installState: 'failed' });
		await I.deleteInstance(row.id);
		expect(I.getInstance(row.id)).toBeUndefined();
	});

	it('marks an install interrupted by a restart as failed', () => {
		const stuck = makeInstance({ installState: 'installing' });
		const fine = makeInstance();
		I.failInterruptedInstalls();
		expect(I.getInstance(stuck.id)).toMatchObject({
			installState: 'failed',
			installMessage: 'Interrupted by a panel restart'
		});
		expect(I.getInstance(fine.id)?.installState).toBe('ready');
	});
});

describe('start refusals', () => {
	it('needs the server files and the EULA', async () => {
		const noEula = makeInstance({ eulaAccepted: false });
		mkdirSync(I.serverDir(noEula.id), { recursive: true });
		writeFileSync(`${I.serverDir(noEula.id)}/server.jar`, '');
		await expect(I.startInstance(noEula.id)).rejects.toThrow(/EULA/);

		const noJar = makeInstance();
		await expect(I.startInstance(noJar.id)).rejects.toThrow(/server\.jar is missing/);
	});

	it('waits for a restore, which swaps the server folder', async () => {
		const row = makeInstance();
		writeFileSync(`${I.serverDir(row.id)}/server.jar`, '');
		const release = claim(row.id, 'restore');
		try {
			await expect(I.startInstance(row.id)).rejects.toThrow(/restore/);
		} finally {
			release();
		}
	});

	it('says an instance is not found', async () => {
		await expect(I.startInstance(999_999)).rejects.toThrow(/not found/i);
	});
});

describe('the instance list', () => {
	it('reports state, and install progress while one is running', async () => {
		const row = makeInstance({ installState: 'installing' });
		setProgress(row.id, { label: 'Downloading mods', done: 3, total: 10 });
		let listed = (await I.listInstances()).find((i) => i.id === row.id);
		expect(listed).toMatchObject({
			state: 'stopped',
			installState: 'installing',
			progress: { label: 'Downloading mods', done: 3, total: 10 }
		});

		clearProgress(row.id);
		listed = (await I.listInstances()).find((i) => i.id === row.id);
		expect(listed?.progress).toBeNull();
	});
});

describe('RCON', () => {
	it('gets a port and a password the first time, and keeps them', () => {
		const id = makeInstance().id;
		const first = I.ensureRcon(id);
		expect(first.port).toBeGreaterThanOrEqual(25575);
		expect(first.password).toMatch(/^[0-9a-f]{32}$/);
		expect(I.ensureRcon(id)).toEqual(first);
	});

	it('gives every instance its own port, never one that is a game port', () => {
		// find the RCON port the next instance would get, then free it and put a game server on it
		const probe = makeInstance().id;
		const next = I.ensureRcon(probe).port;
		db.update(instances)
			.set({ rconPort: null, rconPassword: null })
			.where(eq(instances.id, probe))
			.run();
		const a = makeInstance({ port: next }).id;
		const b = makeInstance().id;
		const ports = [I.ensureRcon(a).port, I.ensureRcon(b).port];
		expect(new Set(ports).size).toBe(2);
		expect(ports).not.toContain(next);
	});

	it('gives each instance a different password', () => {
		const a = I.ensureRcon(makeInstance().id).password;
		const b = I.ensureRcon(makeInstance().id).password;
		expect(a).not.toBe(b);
	});

	it('is kept out of the instance list', async () => {
		const id = makeInstance().id;
		I.ensureRcon(id);
		const row = (await I.listInstances()).find((i) => i.id === id)!;
		expect(row).not.toHaveProperty('rconPassword');
		expect(JSON.stringify(row)).not.toContain(I.ensureRcon(id).password);
	});
});
