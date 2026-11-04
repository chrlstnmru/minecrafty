import { and, eq } from 'drizzle-orm';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LaunchSpec, RunnerStatus } from '#runner/protocol.js';

import { canRetryInstall } from '#lib/instance-origin.js';

import { backupsDir, instanceDir, javaOverride, runnerCommand, serverDir } from './config';
import { db } from './db';
import { instances } from './db/schema';
import * as jobs from './instance-jobs';
import { ensureJava, JAVA_MAJORS, requiredJavaMajor, type JavaMajor } from './java';
import * as live from './live-server';
import { installServer, launchArgs, needsJavaToInstall, type Loader } from './loaders';
import { setProperties } from './server-properties';

export type Instance = typeof instances.$inferSelect;
export type InstanceState = 'stopped' | RunnerStatus['state'];

export const PORT_START = 25565;
const RCON_PORT_START = 25575;

export { instanceDir, serverDir };

/** RCON gets its own port and a password the first time it is needed; both stay the same after. */
export function ensureRcon(id: number) {
	const inst = getInstance(id);
	if (!inst) throw new Error('Instance not found');
	if (inst.rconPort && inst.rconPassword)
		return { port: inst.rconPort, password: inst.rconPassword };

	const taken = new Set(
		db
			.select({ port: instances.port, rcon: instances.rconPort })
			.from(instances)
			.all()
			.flatMap((r) => [r.port, r.rcon])
	);
	let port = RCON_PORT_START;
	while (taken.has(port)) port++;
	const password = crypto.randomUUID().replaceAll('-', '');
	db.update(instances)
		.set({ rconPort: port, rconPassword: password })
		.where(eq(instances.id, id))
		.run();
	return { port, password };
}

/** The first port from 25565 up that no server and no RCON listener uses. */
export function nextFreePort() {
	const used = new Set(
		db
			.select({ port: instances.port, rcon: instances.rconPort })
			.from(instances)
			.all()
			.flatMap((r) => [r.port, r.rcon])
	);
	let port = PORT_START;
	while (used.has(port)) port++;
	return port;
}

/** A game port that another server, or an RCON listener, already uses. */
export class PortTakenError extends Error {}

/** The column only keeps game ports unique, so RCON ports are checked here. */
function assertPortFree(port: number, selfId?: number) {
	const rows = db
		.select({
			id: instances.id,
			name: instances.name,
			port: instances.port,
			rcon: instances.rconPort
		})
		.from(instances)
		.all();
	const game = rows.find((r) => r.id !== selfId && r.port === port);
	if (game) throw new PortTakenError(`Port ${port} is used by ${game.name}`);
	const rcon = rows.find((r) => r.rcon === port);
	if (rcon)
		throw new PortTakenError(
			rcon.id === selfId
				? `Port ${port} is this server's RCON port`
				: `Port ${port} is the RCON port of ${rcon.name}`
		);
}

/** What to tell the user when `e` is a port clash (a race can still reach the column's check); null otherwise. */
export function portConflict(e: unknown) {
	if (e instanceof PortTakenError) return e.message;
	if (String(e).includes('UNIQUE')) return 'Port is already used by another instance';
	return null;
}

export type NewInstance = Omit<typeof instances.$inferInsert, 'id' | 'createdAt'>;

/** Adds the database row and the folder; the server itself is installed by `installBase`. */
export function insertInstance(input: NewInstance) {
	assertPortFree(input.port);
	const row = db.insert(instances).values(input).returning().get();
	mkdirSync(serverDir(row.id), { recursive: true });
	return row;
}

/** Installs the loader's server files, telling `progress` what it is doing. */
export async function installBase(row: Instance, progress: jobs.Report) {
	const mc = row.mcVersion;
	const loader = row.loader as Loader;
	let java: string | undefined;
	if (needsJavaToInstall(loader)) {
		progress('Getting Java ready');
		java = javaOverride ?? (await ensureJava(await requiredJavaMajor(mc)));
	}
	await installServer({
		serverDir: serverDir(row.id),
		loader,
		mc,
		build: row.loaderVersion ?? undefined,
		java,
		report: (step, done, total) =>
			step === 'installing'
				? progress(`Installing ${loader}`)
				: progress('Downloading the server', { done: done ?? 0, total: total ?? 0, bytes: true })
	});
}

function removeInstanceFiles(id: number) {
	rmSync(instanceDir(id), { recursive: true, force: true });
	rmSync(join(backupsDir, String(id)), { recursive: true, force: true });
}

/** Removes a half-created instance: its row (and anything cascading from it) and its folder. */
export function discardInstance(id: number) {
	db.delete(instances).where(eq(instances.id, id)).run();
	removeInstanceFiles(id);
}

/**
 * Adds the instance at once, marked as installing, and installs its server in the background
 * (a download of 50 MB, or Java and an installer, is no reason to keep a form waiting). `finished`
 * settles when the install is over, whichever way it went.
 */
export async function createInstance(input: NewInstance) {
	const row = insertInstance(input);
	return jobs.start(row.id, 'install', ({ progress }) => installBase(row, progress));
}

/** Runs a failed install again from scratch. Only for servers made from a loader: a modpack's own files need the pack. */
export async function retryInstall(id: number) {
	const row = getInstance(id);
	if (!row) throw new Error('Instance not found');
	if (row.installState !== 'failed') throw new Error('Nothing failed here');
	if (!canRetryInstall(row))
		throw new Error('A modpack server cannot be retried; create it again from the pack');
	if (jobs.wasInstalled(id))
		throw new Error(
			'This server was set up before, so a retry would erase its world. Restore a backup instead'
		);
	return jobs.start(id, 'install', async ({ progress }) => {
		// whatever a half-finished install left would only get in the way
		rmSync(serverDir(id), { recursive: true, force: true });
		mkdirSync(serverDir(id), { recursive: true });
		await installBase(row, progress);
	});
}

export function getInstance(id: number) {
	return db.select().from(instances).where(eq(instances.id, id)).get();
}

export async function listInstances() {
	const rows = db.select().from(instances).all();
	return Promise.all(
		rows.map(async ({ rconPassword: _secret, ...row }) => {
			const s = await live.status(row.id);
			return {
				...row,
				state: (s?.state ?? 'stopped') as InstanceState,
				pid: s?.pid ?? null,
				startedAt: s?.startedAt ?? null,
				progress: jobs.jobState(row.id).progress
			};
		})
	);
}

/** The Java major version an instance runs on: the user's choice, else what its Minecraft version needs. */
export async function javaFor(inst: Instance): Promise<JavaMajor> {
	const chosen = JAVA_MAJORS.find((m) => m === inst.javaMajor);
	return chosen ?? (await requiredJavaMajor(inst.mcVersion));
}

const USER_JVM_ARGS = 'user_jvm_args.txt';

/**
 * The arguments Java starts a server with. Forge and NeoForge keep JVM flags in `user_jvm_args.txt`
 * and pass it from their run scripts, which the panel does not use, so it is passed here. It comes first,
 * so the instance's RAM and JVM args after it win where both set a flag (Java keeps the last one).
 * Java 8 cannot read an argument file, so the file is left out there.
 */
export function javaArgs(
	server: string,
	inst: Pick<Instance, 'ramMinMb' | 'ramMaxMb' | 'jvmArgs'>,
	java: JavaMajor,
	launch: string[]
) {
	const fromFile = java > 8 && existsSync(join(server, USER_JVM_ARGS)) ? [`@${USER_JVM_ARGS}`] : [];
	return [
		...fromFile,
		`-Xms${inst.ramMinMb}M`,
		`-Xmx${inst.ramMaxMb}M`,
		...inst.jvmArgs.split(/\s+/).filter(Boolean),
		...launch
	];
}

export async function startInstance(id: number) {
	const inst = await jobs.check(id, 'start');

	const dir = instanceDir(id);
	let current = await live.status(id);
	if (current && current.state !== 'exited') throw new Error('Instance is already running');
	// a finished runner lingers briefly so subscribers see the exit; let it go first
	for (let i = 0; current && i < 30; i++) {
		await Bun.sleep(100);
		current = await live.status(id);
	}

	const server = serverDir(id);
	const launch = launchArgs(server, inst.loader as Loader);
	if (!inst.eulaAccepted) throw new Error('The Minecraft EULA has not been accepted');

	writeFileSync(join(server, 'eula.txt'), 'eula=true\n');
	// RCON is how the panel lists players and runs commands; it is switched on for every start
	const rcon = ensureRcon(id);
	setProperties(join(server, 'server.properties'), {
		'server-port': inst.port,
		'enable-rcon': true,
		'rcon.port': rcon.port,
		'rcon.password': rcon.password
	});

	const java = await javaFor(inst);
	const spec: LaunchSpec = {
		command: javaOverride ?? (await ensureJava(java)),
		args: javaArgs(server, inst, java, launch),
		cwd: server
	};
	writeFileSync(join(dir, 'launch.json'), JSON.stringify(spec, null, 2));

	const logFile = Bun.file(join(dir, 'runner.log'));
	const proc = Bun.spawn(runnerCommand(dir, id), {
		stdin: 'ignore',
		stdout: logFile,
		stderr: logFile,
		detached: true
	});
	proc.unref();

	// wait for the runner to come up so the caller sees a consistent state
	for (let i = 0; i < 30; i++) {
		if (await live.status(id)) return;
		if (proc.exitCode !== null) break;
		await Bun.sleep(100);
	}
	throw new Error('Runner failed to start, see runner.log');
}

export async function stopInstance(id: number) {
	await live.stop(id);
}

/**
 * Stops the server, waits for it to exit (a modded server can take a minute to save), then starts
 * it again. A server that is not running is just started.
 */
export async function restartInstance(id: number) {
	if (await live.isRunning(id)) {
		await stopInstance(id);
		if (!(await live.waitForExit(id)))
			throw new Error('The server did not stop within three minutes');
	}
	await startInstance(id);
}

export async function killInstance(id: number) {
	await live.kill(id);
}

export async function deleteInstance(id: number) {
	await jobs.check(id, 'delete');
	db.delete(instances).where(eq(instances.id, id)).run();
	removeInstanceFiles(id);
}

export type InstanceSettings = Pick<
	Instance,
	'name' | 'port' | 'ramMinMb' | 'ramMaxMb' | 'javaMajor' | 'jvmArgs' | 'autoStart'
>;

/** Changes apply on the next start; a running server keeps the values it launched with. */
export function updateSettings(id: number, settings: InstanceSettings) {
	assertPortFree(settings.port, id);
	return db.update(instances).set(settings).where(eq(instances.id, id)).returning().get();
}

/** Starts every instance flagged auto-start; failures are logged, never thrown. */
export async function autoStartInstances() {
	const rows = db
		.select()
		.from(instances)
		.where(and(eq(instances.autoStart, true), eq(instances.installState, 'ready')))
		.all();
	for (const row of rows) {
		try {
			await startInstance(row.id);
			console.log(`[autostart] started "${row.name}" (#${row.id})`);
		} catch (e) {
			// already running (panel restart) is the normal case, not an error
			const message = e instanceof Error ? e.message : String(e);
			if (message !== 'Instance is already running')
				console.error(`[autostart] "${row.name}" (#${row.id}): ${message}`);
		}
	}
}
