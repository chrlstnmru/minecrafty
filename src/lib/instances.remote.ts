import { error, invalid } from '@sveltejs/kit';
import { command, form, query } from '$app/server';
import { z } from 'zod';
import { requireAdmin } from '#lib/server/auth.js';
import * as instances from '#lib/server/instances.js';
import * as runner from '#lib/server/runner-client.js';
import { LOADERS, getMinecraftVersions, isKnownVersion, latestBuild } from '#lib/server/loaders.js';

const id = z.number().int().positive();

// surface service errors (missing jar, already running, ...) to the UI as 400s
async function userFacing(fn: () => Promise<void>) {
	try {
		await fn();
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'Something went wrong');
	}
}

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

const loader = z.enum(LOADERS);

export const minecraftVersions = query(loader, async (l) => {
	requireAdmin();
	return getMinecraftVersions(l);
});

export const nextPort = query(() => {
	requireAdmin();
	return instances.nextFreePort();
});

export const createInstance = form(
	z.object({
		name: z.string().trim().min(1, 'Enter a name').max(64),
		loader,
		mcVersion: z.string().trim().min(1, 'Choose a Minecraft version'),
		port: z.number().int().min(1024, 'Use a port from 1024').max(65535),
		ramMaxMb: z.number().int().min(512, 'At least 512 MB').max(131072),
		eulaAccepted: z.boolean().default(false)
	}),
	async (data, issue) => {
		requireAdmin();
		if (!data.eulaAccepted) invalid(issue.eulaAccepted('You must accept the Minecraft EULA'));
		if (!(await isKnownVersion(data.loader, data.mcVersion)))
			invalid(issue.mcVersion('Unknown Minecraft version'));
		try {
			await instances.createInstance({
				...data,
				loaderVersion: await latestBuild(data.loader, data.mcVersion),
				ramMinMb: Math.min(1024, data.ramMaxMb)
			});
		} catch (e) {
			if (String(e).includes('UNIQUE'))
				invalid(issue.port('Port is already used by another instance'));
			invalid(e instanceof Error ? e.message : 'Could not create the instance');
		}
	}
);

export const updateInstance = form(
	z
		.object({
			id,
			name: z.string().trim().min(1, 'Enter a name').max(64),
			port: z.number().int().min(1024, 'Use a port from 1024').max(65535),
			ramMinMb: z.number().int().min(256, 'At least 256 MB').max(131072),
			ramMaxMb: z.number().int().min(512, 'At least 512 MB').max(131072),
			// '' means auto: pick from the Minecraft version
			javaMajor: z.enum(['', '8', '17', '21', '25']).transform((v) => (v ? Number(v) : null)),
			jvmArgs: z
				.string()
				.max(1000)
				.regex(/^[^\r\n]*$/, 'Use a single line'),
			autoStart: z.boolean().default(false)
		})
		.refine((d) => d.ramMinMb <= d.ramMaxMb, {
			path: ['ramMinMb'],
			message: 'Minimum cannot exceed maximum'
		}),
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
	z.object({ id, line: z.string().max(1000) }),
	async ({ id: instanceId, line }) => {
		requireAdmin();
		const sent = await runner.send(instances.instanceDir(instanceId), instanceId, {
			type: 'stdin',
			line
		});
		if (!sent) error(400, 'Instance is not running');
	}
);
