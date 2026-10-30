import { error, invalid } from '@sveltejs/kit';
import { command, form, query } from '$app/server';
import * as v from 'valibot';
import { requireAdmin } from '#lib/server/auth.js';
import { idSchema } from '#lib/schemas/common.js';
import { createInstanceSchema, updateInstanceSchema } from '#lib/schemas/instance.js';
import { userFacing } from '#lib/server/http.js';
import * as instances from '#lib/server/instances.js';
import * as runner from '#lib/server/runner-client.js';
import { LOADERS, getMinecraftVersions, isKnownVersion, latestBuild } from '#lib/server/loaders.js';

const id = idSchema;

// there is no runner event for "instance changed", so the stream samples the panel's view of them
export const listInstances = query.live(async function* () {
	requireAdmin();
	let last = '';
	while (true) {
		const rows = await instances.listInstances();
		const json = JSON.stringify(rows);
		if (json !== last) {
			last = json;
			yield rows;
		}
		await Bun.sleep(1000);
	}
});

export const getInstance = query(id, async (instanceId) => {
	requireAdmin();
	const row = instances.getInstance(instanceId);
	if (!row) error(404, 'Instance not found');
	return row;
});

const loader = v.picklist(LOADERS);

export const minecraftVersions = query(loader, async (l) => {
	requireAdmin();
	return getMinecraftVersions(l);
});

export const nextPort = query(() => {
	requireAdmin();
	return instances.nextFreePort();
});

export const createInstance = form(createInstanceSchema, async (data, issue) => {
	requireAdmin();
	if (!(await isKnownVersion(data.loader, data.mcVersion)))
		invalid(issue.mcVersion('Unknown Minecraft version'));
	const loaderVersion = await latestBuild(data.loader, data.mcVersion);
	if (data.loader !== 'vanilla' && !loaderVersion)
		invalid(issue.mcVersion(`${data.loader} has no build for ${data.mcVersion}`));
	try {
		await instances.createInstance({
			...data,
			loaderVersion: loaderVersion ?? null,
			ramMinMb: Math.min(1024, data.ramMaxMb)
		});
	} catch (e) {
		if (String(e).includes('UNIQUE'))
			invalid(issue.port('Port is already used by another instance'));
		invalid(e instanceof Error ? e.message : 'Could not create the instance');
	}
});

export const updateInstance = form(
	updateInstanceSchema,
	async ({ id: instanceId, ...settings }, issue) => {
		requireAdmin();
		if (!instances.getInstance(instanceId)) error(404, 'Instance not found');
		try {
			instances.updateSettings(instanceId, { ...settings, jvmArgs: settings.jvmArgs.trim() });
		} catch (e) {
			if (String(e).includes('UNIQUE'))
				invalid(issue.port('Port is already used by another instance'));
			throw e;
		}
		await getInstance(instanceId).refresh();
	}
);

export const startInstance = command(id, async (instanceId) => {
	requireAdmin();
	await userFacing(() => instances.startInstance(instanceId));
});

export const stopInstance = command(id, async (instanceId) => {
	requireAdmin();
	await userFacing(() => instances.stopInstance(instanceId));
});

export const killInstance = command(id, async (instanceId) => {
	requireAdmin();
	await userFacing(() => instances.killInstance(instanceId));
});

export const deleteInstance = command(id, async (instanceId) => {
	requireAdmin();
	await userFacing(() => instances.deleteInstance(instanceId));
});

export const restartInstance = command(id, async (instanceId) => {
	requireAdmin();
	await userFacing(() => instances.stopInstance(instanceId));
	await Bun.sleep(3000);
	await userFacing(() => instances.startInstance(instanceId));
});

export type ConsoleLine = { seq: number; line: string };

export type ConsoleFrame = {
	state: instances.InstanceState;
	/** identifies one runner process; sequence numbers restart when it changes */
	run: number | null;
	/** recent lines, overlapping with earlier frames so a skipped frame loses nothing */
	lines: ConsoleLine[];
};

const OVERLAP_LINES = 200;

/**
 * Live console for one instance. Live queries only keep the latest pending value, so every
 * frame repeats the most recent lines and clients merge them by sequence number.
 */
export const consoleStream = query.live(id, async function* (instanceId) {
	requireAdmin();
	if (!instances.getInstance(instanceId)) error(404, 'Instance not found');

	const dir = instances.instanceDir(instanceId);
	let state: ConsoleFrame['state'] = 'stopped';
	let run: number | null = null;
	let after = 0;
	let tail: ConsoleLine[] = [];

	yield { state, run, lines: tail } satisfies ConsoleFrame;

	// the runner may not exist yet (or exit and be replaced), so keep looking for one
	while (true) {
		const sub = await runner.subscribe(dir, instanceId, { after, run: run ?? undefined });
		if (!sub) {
			if (state !== 'stopped') {
				state = 'stopped';
				yield { state, run, lines: tail } satisfies ConsoleFrame;
			}
			await Bun.sleep(1000);
			continue;
		}
		try {
			let batch;
			while ((batch = await sub.nextBatch())) {
				const fresh: ConsoleLine[] = [];
				for (const msg of batch) {
					if (msg.type === 'log') {
						fresh.push({ seq: msg.seq, line: msg.line });
						after = msg.seq;
					} else {
						state = msg.state;
						if (msg.startedAt !== run) {
							run = msg.startedAt;
							tail = [];
						}
					}
				}
				tail = [...tail, ...fresh].slice(-OVERLAP_LINES - fresh.length);
				yield { state, run, lines: tail } satisfies ConsoleFrame;
				tail = tail.slice(-OVERLAP_LINES);
			}
		} finally {
			sub.close();
		}
	}
});

export const sendCommand = command(
	v.object({ id, line: v.pipe(v.string(), v.maxLength(1000)) }),
	async ({ id: instanceId, line }) => {
		requireAdmin();
		const sent = await runner.send(instances.instanceDir(instanceId), instanceId, {
			type: 'stdin',
			line
		});
		if (!sent) error(400, 'Instance is not running');
	}
);
