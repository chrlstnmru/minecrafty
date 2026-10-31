import { describe, expect, it } from 'vitest';

import { assertMayWriteCode, isHostCode } from './host-code';

const owner = { id: 1, role: 'owner' as const };
const user = { id: 2, role: 'user' as const };

describe('host code', () => {
	it('knows the files Java, a loader or the system would run', () => {
		for (const rel of [
			'plugins/evil.jar',
			'mods/x.JAR',
			'mods/x.jar.',
			'mods\\x.jar ',
			'Main.class',
			'start.sh',
			'start.bat',
			'tools/run.ps1',
			'libnative.so',
			'user_jvm_args.txt',
			'USER_JVM_ARGS.TXT'
		])
			expect(isHostCode(rel), rel).toBe(true);
	});

	it('leaves config, worlds and disabled mods alone', () => {
		for (const rel of [
			'server.properties',
			'config/sodium.toml',
			'world/level.dat',
			'mods/x.jar.disabled',
			'jar',
			'',
			'mods/'
		])
			expect(isHostCode(rel), rel).toBe(false);
	});

	it('lets only the owner write code', () => {
		expect(() => assertMayWriteCode(user, 'plugins/evil.jar')).toThrow(
			/Only the owner may add or change evil\.jar/
		);
		expect(() => assertMayWriteCode(user, 'config/a.toml')).not.toThrow();
		expect(() => assertMayWriteCode(owner, 'plugins/evil.jar')).not.toThrow();
	});
});
