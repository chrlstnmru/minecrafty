import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { readProperties, setProperties } from './server-properties';

let file: string;
beforeEach(() => {
	file = join(mkdtempSync(join(tmpdir(), 'props-')), 'server.properties');
});

describe('readProperties', () => {
	it('returns nothing for a missing file', () => {
		expect(readProperties(file)).toEqual({});
	});

	it('reads key=value pairs and skips comments and blank lines', () => {
		writeFileSync(file, '#Minecraft server properties\n\nmotd=Hello\nserver-port=25565\nempty=\n');
		expect(readProperties(file)).toEqual({ motd: 'Hello', 'server-port': '25565', empty: '' });
	});

	it('keeps an equals sign inside a value', () => {
		writeFileSync(file, 'url=https://example.com/?a=b\n');
		expect(readProperties(file).url).toBe('https://example.com/?a=b');
	});
});

describe('setProperties', () => {
	it('creates the file, merges new keys and keeps every other line (comments included)', () => {
		writeFileSync(file, '#comment\nserver-port=25565\nmotd=hello\n');
		setProperties(file, { 'server-port': 25570, extra: true });
		expect(readFileSync(file, 'utf8')).toBe(
			'#comment\nserver-port=25570\nmotd=hello\nextra=true\n'
		);
	});

	it('writes a new file when there is none', () => {
		setProperties(file, { a: 1 });
		expect(readFileSync(file, 'utf8')).toBe('a=1\n');
	});

	it('does not add blank lines on repeated writes', () => {
		setProperties(file, { a: 1 });
		setProperties(file, { b: 2 });
		setProperties(file, { a: 3 });
		expect(readFileSync(file, 'utf8')).toBe('a=3\nb=2\n');
	});

	it('escapes backslashes the way Java properties do, and reads them back', () => {
		setProperties(file, { prompt: '"a\\b"' });
		expect(readFileSync(file, 'utf8')).toBe('prompt="a\\\\b"\n');
		expect(readProperties(file).prompt).toBe('"a\\b"');
	});

	it('accepts numbers and booleans and reads them as text', () => {
		setProperties(file, { port: 25565, online: false });
		expect(readProperties(file)).toEqual({ port: '25565', online: 'false' });
	});
});
