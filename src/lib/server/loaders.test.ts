import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { launchArgs, loaderBuilds, needsJavaToInstall } from './loaders';

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'loaders-'));
});
const touch = (path: string) => {
	mkdirSync(join(dir, path, '..'), { recursive: true });
	writeFileSync(join(dir, path), '');
};

describe('launchArgs', () => {
	it('runs server.jar for the loaders that download one', () => {
		touch('server.jar');
		for (const loader of ['vanilla', 'paper', 'purpur', 'fabric'] as const)
			expect(launchArgs(dir, loader)).toEqual(['-jar', 'server.jar', 'nogui']);
	});

	it('reports a missing jar by name', () => {
		expect(() => launchArgs(dir, 'paper')).toThrow(/server\.jar is missing/);
	});

	it('runs the Quilt launcher', () => {
		touch('quilt-server-launch.jar');
		expect(launchArgs(dir, 'quilt')).toEqual(['-jar', 'quilt-server-launch.jar', 'nogui']);
		const empty = mkdtempSync(join(tmpdir(), 'loaders-'));
		expect(() => launchArgs(empty, 'quilt')).toThrow(/quilt-server-launch\.jar is missing/);
	});

	it.each(['forge', 'neoforge'] as const)('uses the argument file of modern %s', (loader) => {
		const pkg =
			loader === 'forge' ? 'minecraftforge/forge/1.20.1-47.4.0' : 'neoforged/neoforge/21.4.1';
		touch(`libraries/net/${pkg}/unix_args.txt`);
		touch(`libraries/net/${pkg}/win_args.txt`);
		const args = launchArgs(dir, loader);
		expect(args).toHaveLength(2);
		expect(args[0]).toMatch(new RegExp(`^@libraries/net/${pkg}/(unix|win)_args\\.txt$`));
		expect(args[1]).toBe('nogui');
	});

	it('falls back to the launcher jar of legacy Forge', () => {
		touch('forge-1.12.2-14.23.5.2859.jar');
		expect(launchArgs(dir, 'forge')).toEqual(['-jar', 'forge-1.12.2-14.23.5.2859.jar', 'nogui']);
	});

	it('says so when the Forge installer produced nothing runnable', () => {
		expect(() => launchArgs(dir, 'forge')).toThrow(/did not produce a runnable server/);
	});
});

describe('needsJavaToInstall', () => {
	it('is true only for the installer-based loaders', () => {
		expect(
			['vanilla', 'paper', 'purpur', 'fabric'].map((l) => needsJavaToInstall(l as never))
		).toEqual([false, false, false, false]);
		expect(['quilt', 'forge', 'neoforge'].map((l) => needsJavaToInstall(l as never))).toEqual([
			true,
			true,
			true
		]);
	});
});

describe('loaderBuilds', () => {
	afterEach(() => vi.restoreAllMocks());

	it("reads Forge's builds for one Minecraft version from its maven list, newest first", async () => {
		const xml = ['1.20.1-47.2.0', '1.20.1-47.3.0', '1.20.4-49.0.1', '1.20.1-47.1.0']
			.map((v) => `<version>${v}</version>`)
			.join('');
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(xml));
		expect(await loaderBuilds('forge', '1.20.1')).toEqual(['47.3.0', '47.2.0', '47.1.0']);
	});

	it('leaves out Fabric betas, and offers vanilla nothing', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			Response.json([
				{ version: '0.16.10', stable: true },
				{ version: '0.17.0-beta.1', stable: false },
				{ version: '0.16.9', stable: false }
			])
		);
		expect(await loaderBuilds('fabric', '1.21.1')).toEqual(['0.16.10', '0.16.9']);
		expect(await loaderBuilds('vanilla', '1.21.1')).toEqual([]);
	});
});
