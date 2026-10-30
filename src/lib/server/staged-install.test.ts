import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { mergeStaged, removeStale } from './staged-install';

let server: string;
let staging: string;
const put = (base: string, rel: string, content: string) => {
	mkdirSync(join(base, rel, '..'), { recursive: true });
	writeFileSync(join(base, rel), content);
};
const read = (base: string, rel: string) => readFileSync(join(base, rel), 'utf8');

beforeEach(() => {
	const work = mkdtempSync(join(tmpdir(), 'staged-'));
	server = join(work, 'server');
	staging = join(work, 'staging');
	mkdirSync(server);
	mkdirSync(staging);
});

describe('mergeStaged', () => {
	it('merges folders instead of replacing them, and replaces files that are already there', () => {
		put(server, 'mods/old.jar', 'old');
		put(server, 'mods/same.jar', 'v1');
		put(server, 'world/level.dat', 'level');
		put(staging, 'mods/same.jar', 'v2');
		put(staging, 'mods/new.jar', 'new');
		put(staging, 'config/a.toml', 'cfg');

		mergeStaged(server, staging);

		expect(read(server, 'mods/old.jar')).toBe('old');
		expect(read(server, 'mods/same.jar')).toBe('v2');
		expect(read(server, 'mods/new.jar')).toBe('new');
		expect(read(server, 'config/a.toml')).toBe('cfg');
		expect(read(server, 'world/level.dat')).toBe('level');
		expect(existsSync(staging)).toBe(false);
	});

	it('keeps a user_jvm_args.txt the user already edited', () => {
		put(server, 'user_jvm_args.txt', 'mine');
		put(staging, 'user_jvm_args.txt', 'default');
		put(staging, 'run.sh', 'run');
		mergeStaged(server, staging);
		expect(read(server, 'user_jvm_args.txt')).toBe('mine');
		expect(read(server, 'run.sh')).toBe('run');
	});

	it('writes user_jvm_args.txt when there is none yet', () => {
		put(staging, 'user_jvm_args.txt', 'default');
		mergeStaged(server, staging);
		expect(read(server, 'user_jvm_args.txt')).toBe('default');
	});

	it('replaces a folder that stands where a file belongs', () => {
		mkdirSync(join(server, 'thing'));
		put(server, 'thing/inner.txt', 'x');
		put(staging, 'thing', 'now a file');
		mergeStaged(server, staging);
		expect(read(server, 'thing')).toBe('now a file');
	});
});

describe('removeStale', () => {
	it('removes only what the old loader install left behind', () => {
		put(server, 'libraries/net/neoforged/old/unix_args.txt', 'old');
		put(server, 'run.sh', 'old');
		put(server, 'mods/a.jar', 'mod');
		put(server, 'world/level.dat', 'level');
		removeStale(server, 'neoforge');
		expect(existsSync(join(server, 'libraries'))).toBe(false);
		expect(existsSync(join(server, 'run.sh'))).toBe(false);
		expect(existsSync(join(server, 'mods/a.jar'))).toBe(true);
		expect(existsSync(join(server, 'world/level.dat'))).toBe(true);
	});

	it('removes nothing for loaders that only replace server.jar', () => {
		put(server, 'server.jar', 'jar');
		put(server, 'libraries/x', 'paper libs');
		removeStale(server, 'paper');
		expect(existsSync(join(server, 'server.jar'))).toBe(true);
		expect(existsSync(join(server, 'libraries/x'))).toBe(true);
	});
});
