import * as v from 'valibot';
import { describe, expect, it } from 'vitest';

import { loginSchema, setupSchema } from './auth';
import { idSchema, searchArgsSchema } from './common';
import { uploadBatchSchema } from './files';
import { createInstanceSchema, updateInstanceSchema } from './instance';
import { importModpackSchema } from './modpack';
import { packOptionsSchema } from './packs';

/** The messages and the field each one is attached to. */
const issues = <T extends v.GenericSchema>(schema: T, input: unknown) => {
	const result = v.safeParse(schema, input);
	return result.success
		? []
		: result.issues.map((i) => [i.path?.map((p) => p.key).join('.') ?? '', i.message]);
};

describe('login and setup', () => {
	it('login needs both fields', () => {
		expect(issues(loginSchema, { username: '  ', _password: '' })).toEqual([
			['username', 'Enter your username'],
			['_password', 'Enter your password']
		]);
		expect(issues(loginSchema, { username: 'admin', _password: 'x' })).toEqual([]);
	});

	it('setup checks the username, password length and confirmation', () => {
		expect(
			issues(setupSchema, { username: 'ab', _password: 'short', _confirm: 'other', _code: ' ' })
		).toEqual([
			['username', 'Use 3-32 letters, numbers, . _ -'],
			['_password', 'At least 8 characters'],
			['_code', 'Enter the setup code'],
			['_confirm', 'Passwords do not match'] // they really do differ too
		]);
	});

	it('puts a mismatch on the confirmation field', () => {
		expect(
			issues(setupSchema, {
				username: 'admin',
				_password: 'password123',
				_confirm: 'password124',
				_code: 'c'
			})
		).toEqual([['_confirm', 'Passwords do not match']]);
		expect(
			issues(setupSchema, {
				username: 'admin',
				_password: 'password123',
				_confirm: 'password123',
				_code: 'c'
			})
		).toEqual([]);
	});

	it('trims the username', () => {
		const result = v.safeParse(setupSchema, {
			username: '  admin  ',
			_password: 'password123',
			_confirm: 'password123',
			_code: 'c'
		});
		expect(result.success && result.output.username).toBe('admin');
	});
});

describe('instances', () => {
	const valid = {
		name: 'Survival',
		loader: 'paper',
		mcVersion: '1.21.4',
		port: 25565,
		ramMaxMb: 2048,
		eulaAccepted: true
	};

	it('accepts a complete instance', () => {
		expect(issues(createInstanceSchema, valid)).toEqual([]);
	});

	it('requires the EULA, and reports it on that field', () => {
		expect(issues(createInstanceSchema, { ...valid, eulaAccepted: false })).toEqual([
			['eulaAccepted', 'You must accept the Minecraft EULA']
		]);
		expect(issues(createInstanceSchema, { ...valid, eulaAccepted: undefined })).toEqual([
			['eulaAccepted', 'You must accept the Minecraft EULA']
		]);
	});

	it('checks port and memory ranges and the loader', () => {
		expect(issues(createInstanceSchema, { ...valid, port: 80 })).toEqual([
			['port', 'Use a port from 1024']
		]);
		expect(issues(createInstanceSchema, { ...valid, port: 70000 })[0][0]).toBe('port');
		expect(issues(createInstanceSchema, { ...valid, ramMaxMb: 128 })).toEqual([
			['ramMaxMb', 'At least 512 MB']
		]);
		expect(issues(createInstanceSchema, { ...valid, loader: 'bukkit' })[0][0]).toBe('loader');
		expect(issues(createInstanceSchema, { ...valid, name: '   ' })).toEqual([
			['name', 'Enter a name']
		]);
	});

	const update = {
		id: 1,
		name: 'n',
		port: 25565,
		ramMinMb: 512,
		ramMaxMb: 1024,
		javaMajor: '',
		jvmArgs: '',
		autoStart: false
	};

	it('rejects a minimum above the maximum on the minimum field', () => {
		expect(issues(updateInstanceSchema, { ...update, ramMinMb: 4096 })).toEqual([
			['ramMinMb', 'Minimum cannot exceed maximum']
		]);
	});

	it('turns the Java choice into a number, or null for automatic', () => {
		const auto = v.safeParse(updateInstanceSchema, update);
		const pick = v.safeParse(updateInstanceSchema, { ...update, javaMajor: '21' });
		expect(auto.success && auto.output.javaMajor).toBeNull();
		expect(pick.success && pick.output.javaMajor).toBe(21);
		expect(issues(updateInstanceSchema, { ...update, javaMajor: '9' })[0][0]).toBe('javaMajor');
	});

	it('keeps JVM arguments on one line', () => {
		expect(issues(updateInstanceSchema, { ...update, jvmArgs: '-Xa\n-Xb' })).toEqual([
			['jvmArgs', 'Use a single line']
		]);
	});

	it('treats an unchecked auto-start as false', () => {
		const result = v.safeParse(updateInstanceSchema, { ...update, autoStart: undefined });
		expect(result.success && result.output.autoStart).toBe(false);
	});
});

describe('modpack import and pack options', () => {
	it('import needs a version, a name, a port, memory and the EULA', () => {
		const ok = { versionId: 'abc', name: 'Pack', port: 25565, ramMaxMb: 4096, eulaAccepted: true };
		expect(issues(importModpackSchema, ok)).toEqual([]);
		expect(issues(importModpackSchema, { ...ok, versionId: '' })).toEqual([
			['versionId', 'Choose a modpack version']
		]);
		expect(issues(importModpackSchema, { ...ok, eulaAccepted: false })[0][0]).toBe('eulaAccepted');
	});

	it('pack options bound the prompt length', () => {
		expect(issues(packOptionsSchema, { id: 1, required: true, prompt: 'x'.repeat(200) })).toEqual(
			[]
		);
		expect(
			issues(packOptionsSchema, { id: 1, required: false, prompt: 'x'.repeat(201) })[0][0]
		).toBe('prompt');
	});
});

describe('shared argument schemas', () => {
	it('ids are positive integers', () => {
		expect(issues(idSchema, 1)).toEqual([]);
		for (const bad of [0, -1, 1.5, '1', null]) expect(issues(idSchema, bad)).not.toEqual([]);
	});

	it('search limits are bounded', () => {
		expect(issues(searchArgsSchema, { id: 1, query: 'x', limit: 20 })).toEqual([]);
		expect(issues(searchArgsSchema, { id: 1, query: 'x', limit: 101 })[0][0]).toBe('limit');
		expect(issues(searchArgsSchema, { id: 1, query: 'x'.repeat(101), limit: 20 })[0][0]).toBe(
			'query'
		);
	});
});

describe('upload batches', () => {
	it('need at least one file, and cap the count', () => {
		const item = { file: new File(['x'], 'a'), path: 'a' };
		expect(issues(uploadBatchSchema, { id: 1, path: '', items: [item] })).toEqual([]);
		expect(issues(uploadBatchSchema, { id: 1, path: '', items: [] })).not.toEqual([]);
		expect(
			issues(uploadBatchSchema, { id: 1, path: '', items: Array(2001).fill(item) })
		).not.toEqual([]);
		expect(
			issues(uploadBatchSchema, { id: 1, path: '', items: [{ file: 'not a file', path: 'a' }] })
		).not.toEqual([]);
	});
});
