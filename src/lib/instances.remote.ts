import { error, invalid } from '@sveltejs/kit';
import { command, form, query } from '$app/server';
import * as v from 'valibot';
import { permissionsFor, visibleInstanceIds } from '#lib/server/access.js';
import { requireInstance, requirePanel, requirePermission, requireUser } from '#lib/server/auth.js';
import { idSchema } from '#lib/schemas/common.js';
import { createInstanceSchema, updateInstanceSchema } from '#lib/schemas/instance.js';
import { record } from '#lib/server/audit.js';
import { userFacing } from '#lib/server/http.js';
import * as instances from '#lib/server/instances.js';
import * as runner from '#lib/server/runner-client.js';
import { backfillPackIcons } from '#lib/server/modpacks.js';
import { LOADERS, getMinecraftVersions, isKnownVersion, latestBuild } from '#lib/server/loaders.js';

const id = idSchema;

// there is no runner event for "instance changed", so the stream samples the panel's view of them
export const listInstances = query.live(async function* () {
	const user = requireUser();
	let last = '';
	while (true) {
		const visible = visibleInstanceIds(user);
		const rows = (await instances.listInstances())
			.filter((r) => !visible || visible.includes(r.id))
			.map((r) => ({ ...r, permissions: permissionsFor(user, r.id) }));
		const json = JSON.stringify(rows);
		if (json !== last) {
			last = json;
			yield rows;
		}
		await Bun.sleep(1000);
	}
});

export const getInstance = query(id, async (instanceId) => {
	const user = requireInstance(instanceId);
	const row = instances.getInstance(instanceId);
	if (!row) error(404, 'Instance not found');
	// the RCON password is for the panel's own use
	const { rconPassword: _secret, ...visible } = row;
	return {
		...visible,
		permissions: permissionsFor(user, instanceId)
	};
});

const loader = v.picklist(LOADERS);

export const minecraftVersions = query(loader, async (l) => {
	requirePanel('instances.create');
	return getMinecraftVersions(l);
});

export const nextPort = query(() => {
	requirePanel('instances.create');
	return instances.nextFreePort();
});

export const createInstance = form(createInstanceSchema, async (data, issue) => {
	requirePanel('instances.create');
	if (!(await isKnownVersion(data.loader, data.mcVersion)))
		invalid(issue.mcVersion('Unknown Minecraft version'));
	const loaderVersion = await latestBuild(data.loader, data.mcVersion);
	if (data.loader !== 'vanilla' && !loaderVersion)
		invalid(issue.mcVersion(`${data.loader} has no build for ${data.mcVersion}`));
	try {
		// returns at once; the install carries on in the background and shows in the list
		const made = instances.createInstance({
			...data,
			loaderVersion: loaderVersion ?? null,
			ramMinMb: Math.min(1024, data.ramMaxMb)
		});
		record({
			action: 'instance.create',
			summary: `Created the server (${data.loader} ${data.mcVersion})`,
			instanceId: made.row.id
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
		requirePermission(instanceId, 'settings');
		const before = instances.getInstance(instanceId);
		if (!before) error(404, 'Instance not found');
		try {
			instances.updateSettings(instanceId, { ...settings, jvmArgs: settings.jvmArgs.trim() });
			const changed = (
				[
					['name', settings.name !== before.name],
					['port', settings.port !== before.port],
					[
						'memory',
						settings.ramMinMb !== before.ramMinMb || settings.ramMaxMb !== before.ramMaxMb
					],
					['Java version', settings.javaMajor !== before.javaMajor],
					['JVM arguments', settings.jvmArgs.trim() !== before.jvmArgs],
					['auto-start', settings.autoStart !== before.autoStart]
				] as const
			)
				.filter(([, differs]) => differs)
				.map(([label]) => label);
			if (changed.length)
				record({
					action: 'instance.settings',
					summary: `Changed ${changed.join(', ')}`,
					instanceId
				});
		} catch (e) {
			if (String(e).includes('UNIQUE'))
				invalid(issue.port('Port is already used by another instance'));
			throw e;
		}
		await getInstance(instanceId).refresh();
	}
);

export const startInstance = command(id, async (instanceId) => {
	requirePermission(instanceId, 'control');
	await userFacing(() => instances.startInstance(instanceId));
	record({ action: 'instance.start', summary: 'Started the server', instanceId });
});

export const stopInstance = command(id, async (instanceId) => {
	requirePermission(instanceId, 'control');
	await userFacing(() => instances.stopInstance(instanceId));
	record({ action: 'instance.stop', summary: 'Stopped the server', instanceId });
});

export const killInstance = command(id, async (instanceId) => {
	requirePermission(instanceId, 'control');
	await userFacing(() => instances.killInstance(instanceId));
	record({ action: 'instance.kill', summary: 'Killed the server', instanceId });
});

export const deleteInstance = command(id, async (instanceId) => {
	requirePanel('instances.delete');
	// the entry is written first, while the instance's name can still be looked up
	record({ action: 'instance.delete', summary: 'Deleted the server', instanceId });
	await userFacing(() => instances.deleteInstance(instanceId));
});

export const restartInstance = command(id, async (instanceId) => {
	requirePermission(instanceId, 'control');
	await userFacing(() => instances.restartInstance(instanceId));
	record({ action: 'instance.restart', summary: 'Restarted the server', instanceId });
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
	requirePermission(instanceId, 'console');
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
		requirePermission(instanceId, 'console');
		const sent = await runner.send(instances.instanceDir(instanceId), instanceId, {
			type: 'stdin',
			line
		});
		if (!sent) error(400, 'Instance is not running');
		record({
			action: 'console.command',
			summary: `Ran: ${line.trim().slice(0, 200)}`,
			instanceId
		});
	}
);

/** Fetches the icon of modpack instances made before it was kept; the instance list picks it up. */
export const refreshPackIcons = command(async () => {
	requireUser();
	return userFacing(() => backfillPackIcons());
});

/** Runs a failed install again; it carries on in the background. */
export const retryInstall = command(id, async (instanceId) => {
	requirePermission(instanceId, 'settings');
	await userFacing(async () => void instances.retryInstall(instanceId));
	record({ action: 'instance.retry', summary: 'Retried the install', instanceId });
});
