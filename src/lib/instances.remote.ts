import { command, form, query } from '$app/server';
import { error, invalid } from '@sveltejs/kit';
import * as v from 'valibot';

import { backfillPackIcons } from '#lib/modpacks/server/modpacks.js';
import { idSchema } from '#lib/schemas/common.js';
import { createInstanceSchema, updateInstanceSchema } from '#lib/schemas/instance.js';
import { permissionsFor } from '#lib/server/access.js';
import { record } from '#lib/server/audit.js';
import { requireInstance, requirePanel, requirePermission, requireUser } from '#lib/server/auth.js';
import { userFacing } from '#lib/server/http.js';
import * as instances from '#lib/server/instances.js';
import * as live from '#lib/server/live-server.js';
import { LOADERS, getMinecraftVersions, isKnownVersion, latestBuild } from '#lib/server/loaders.js';

const id = idSchema;

/** The instances the user may see as they are now; the `instances` feed keeps them current. */
export const listInstances = query(async () => instances.visibleInstances(requireUser()));

/** The small list the sidebar and breadcrumbs render; the `nav` feed says when to refetch it. */
export const listNavInstances = query(async () => instances.navInstances(requireUser()));

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
		const made = await instances.createInstance({
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
		const port = instances.portConflict(e);
		if (port) invalid(issue.port(port));
		invalid(e instanceof Error ? e.message : 'Could not create the instance');
	}
});

export const updateInstance = form(
	updateInstanceSchema,
	async ({ id: instanceId, ...settings }, issue) => {
		const user = requirePermission(instanceId, 'settings');
		const before = instances.getInstance(instanceId);
		if (!before) error(404, 'Instance not found');
		// a JVM flag such as -XX:OnError runs a command on the host, so these are the owner's alone
		if (user.role !== 'owner' && settings.jvmArgs.trim() !== before.jvmArgs)
			invalid(issue.jvmArgs('Only the owner may change the JVM arguments'));
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
			const port = instances.portConflict(e);
			if (port) invalid(issue.port(port));
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

export const sendCommand = command(
	v.object({ id, line: v.pipe(v.string(), v.maxLength(1000)) }),
	async ({ id: instanceId, line }) => {
		requirePermission(instanceId, 'console');
		const sent = await live.sendLine(instanceId, line);
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
	await userFacing(async () => void (await instances.retryInstall(instanceId)));
	record({ action: 'instance.retry', summary: 'Retried the install', instanceId });
});
