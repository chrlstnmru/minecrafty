import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { LaunchSpec, RunnerStatus } from '../../../runner/protocol';
import { instancesDir, javaOverride, runnerEntry } from './config';
import { ensureJava, JAVA_MAJORS, requiredJavaMajor, type JavaMajor } from './java';
import { db } from './db';
import { instances } from './db/schema';
import { installServer, launchArgs, needsJavaToInstall, type Loader } from './loaders';
import * as runner from './runner-client';
import { setProperties } from './server-properties';

export type Instance = typeof instances.$inferSelect;
export type InstanceState = 'stopped' | RunnerStatus['state'];

export const PORT_START = 25565;

export const instanceDir = (id: number) => join(instancesDir, String(id));
export const serverDir = (id: number) => join(instanceDir(id), 'server');

export function nextFreePort() {
	const used = new Set(
		db
			.select({ port: instances.port })
			.from(instances)
			.all()
			.map((r) => r.port)
	);
	let port = PORT_START;
	while (used.has(port)) port++;
	return port;
}

export async function createInstance(
	input: Omit<typeof instances.$inferInsert, 'id' | 'createdAt'>
) {
	const row = db.insert(instances).values(input).returning().get();
	mkdirSync(serverDir(row.id), { recursive: true });
	try {
		const mc = row.mcVersion;
		const java = needsJavaToInstall(row.loader as Loader)
			? (javaOverride ?? (await ensureJava(await requiredJavaMajor(mc))))
			: undefined;
		await installServer({
			serverDir: serverDir(row.id),
			loader: row.loader as Loader,
			mc,
			build: row.loaderVersion ?? undefined,
			java
		});
	} catch (e) {
		// don't leave a half-created instance behind
		db.delete(instances).where(eq(instances.id, row.id)).run();
		rmSync(instanceDir(row.id), { recursive: true, force: true });
		throw e;
	}
	writeFileSync(
		join(instanceDir(row.id), 'instance.json'),
		JSON.stringify(
			{
				loader: row.loader,
				mcVersion: row.mcVersion,
				ramMaxMb: row.ramMaxMb,
				jvmArgs: row.jvmArgs
			},
			null,
			2
		)
	);
	return row;
}

export function getInstance(id: number) {
	return db.select().from(instances).where(eq(instances.id, id)).get();
}

export async function listInstances() {
	const rows = db.select().from(instances).all();
	return Promise.all(
		rows.map(async (row) => {
			const s = await runner.status(instanceDir(row.id), row.id);
			return { ...row, state: (s?.state ?? 'stopped') as InstanceState, pid: s?.pid ?? null };
		})
	);
}

/** The Java major version an instance runs on: the user's choice, else what its Minecraft version needs. */
export async function javaFor(inst: Instance): Promise<JavaMajor> {
	const chosen = JAVA_MAJORS.find((m) => m === inst.javaMajor);
	return chosen ?? (await requiredJavaMajor(inst.mcVersion));
}

export async function startInstance(id: number) {
	const inst = getInstance(id);
	if (!inst) throw new Error('Instance not found');

	const dir = instanceDir(id);
	let live = await runner.status(dir, id);
	if (live && live.state !== 'exited') throw new Error('Instance is already running');
	// a finished runner lingers briefly so subscribers see the exit; let it go first
	for (let i = 0; live && i < 30; i++) {
		await Bun.sleep(100);
		live = await runner.status(dir, id);
	}

	const server = serverDir(id);
	const launch = launchArgs(server, inst.loader as Loader);
	if (!inst.eulaAccepted) throw new Error('The Minecraft EULA has not been accepted');

	writeFileSync(join(server, 'eula.txt'), 'eula=true\n');
	setProperties(join(server, 'server.properties'), { 'server-port': inst.port });

	const spec: LaunchSpec = {
		command: javaOverride ?? (await ensureJava(await javaFor(inst))),
		args: [
			`-Xms${inst.ramMinMb}M`,
			`-Xmx${inst.ramMaxMb}M`,
			...inst.jvmArgs.split(/\s+/).filter(Boolean),
			...launch
		],
		cwd: server
	};
	writeFileSync(join(dir, 'launch.json'), JSON.stringify(spec, null, 2));

	const logFile = Bun.file(join(dir, 'runner.log'));
	const proc = Bun.spawn([process.execPath, runnerEntry, dir, String(id)], {
		stdin: 'ignore',
		stdout: logFile,
		stderr: logFile,
		detached: true
	});
	proc.unref();

	// wait for the runner to come up so the caller sees a consistent state
	for (let i = 0; i < 30; i++) {
		if (await runner.status(dir, id)) return;
		if (proc.exitCode !== null) break;
		await Bun.sleep(100);
	}
	throw new Error('Runner failed to start, see runner.log');
}

export async function stopInstance(id: number) {
	await runner.send(instanceDir(id), id, { type: 'stop' });
}

export async function killInstance(id: number) {
	await runner.send(instanceDir(id), id, { type: 'kill' });
}

export async function deleteInstance(id: number) {
	const live = await runner.status(instanceDir(id), id);
	if (live && live.state !== 'exited') throw new Error('Stop the instance before deleting it');
	db.delete(instances).where(eq(instances.id, id)).run();
	rmSync(instanceDir(id), { recursive: true, force: true });
}

export type InstanceSettings = Pick<
	Instance,
	'name' | 'port' | 'ramMinMb' | 'ramMaxMb' | 'javaMajor' | 'jvmArgs' | 'autoStart'
>;

/** Changes apply on the next start; a running server keeps the values it launched with. */
export function updateSettings(id: number, settings: InstanceSettings) {
	return db.update(instances).set(settings).where(eq(instances.id, id)).returning().get();
}

/** Starts every instance flagged auto-start; failures are logged, never thrown. */
export async function autoStartInstances() {
	const rows = db.select().from(instances).where(eq(instances.autoStart, true)).all();
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
