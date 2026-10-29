import { error, invalid } from '@sveltejs/kit';
import { command, form, query } from '$app/server';
import { z } from 'zod';
import { requireAdmin } from '#lib/server/auth.js';
import * as instances from '#lib/server/instances.js';
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

export const listInstances = query(async () => {
	requireAdmin();
	return instances.listInstances();
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
		await listInstances().refresh();
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
