import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { makeInstance } from '#test/instance.js';

import { propertyFields, propertyGroups, validateProperty } from '../server-properties-catalog';
import { serverDir } from './instances';
import { getServerProperties, saveServerProperties } from './properties';

describe('validateProperty', () => {
	it('checks booleans, numbers against their range, and select options', () => {
		expect(validateProperty('pvp', 'true')).toBeNull();
		expect(validateProperty('pvp', 'yes')).toMatch(/true or false/);
		expect(validateProperty('view-distance', '12')).toBeNull();
		expect(validateProperty('view-distance', '2')).toMatch(/Between 3 and 32/);
		expect(validateProperty('view-distance', '12.5')).toMatch(/whole number/);
		expect(validateProperty('view-distance', '')).toMatch(/whole number/);
		expect(validateProperty('network-compression-threshold', '-1')).toBeNull();
		expect(validateProperty('difficulty', 'hard')).toBeNull();
		expect(validateProperty('difficulty', 'brutal')).toMatch(/options/);
	});

	it('rejects line breaks and very long values for any key', () => {
		expect(validateProperty('motd', 'one\ntwo')).toMatch(/single line/);
		expect(validateProperty('some.other', 'a\rb')).toMatch(/single line/);
		expect(validateProperty('motd', 'x'.repeat(1001))).toMatch(/At most/);
		expect(validateProperty('motd', 'A §bcoloured§r server')).toBeNull();
	});

	it('every default in the catalog is itself valid', () => {
		for (const field of propertyFields.values())
			expect(validateProperty(field.key, field.default), field.key).toBeNull();
	});

	it('has no key twice and none of the panel-managed ones', () => {
		const keys = propertyGroups.flatMap((g) => g.fields.map((f) => f.key));
		expect(new Set(keys).size).toBe(keys.length);
		for (const managed of ['server-port', 'resource-pack', 'rcon.password'])
			expect(keys).not.toContain(managed);
	});
});

let id: number;
let file: string;

beforeEach(() => {
	id = makeInstance().id;
	file = join(serverDir(id), 'server.properties');
	mkdirSync(serverDir(id), { recursive: true });
});

describe('getServerProperties', () => {
	it('reports a missing file, and hides managed keys', () => {
		expect(getServerProperties(id)).toEqual({ exists: false, values: {} });
		writeFileSync(
			file,
			'motd=Hi\nserver-port=25565\nrcon.password=secret\nresource-pack=http://x\n'
		);
		expect(getServerProperties(id)).toEqual({ exists: true, values: { motd: 'Hi' } });
	});
});

describe('saveServerProperties', () => {
	it('writes only what differs, keeping comments and unknown lines', () => {
		writeFileSync(file, '#Minecraft server properties\nmotd=Old\nmy.custom=1\npvp=true\n');
		saveServerProperties(id, { motd: 'New', pvp: 'true', 'view-distance': '10', hardcore: 'true' });
		expect(readFileSync(file, 'utf8')).toBe(
			'#Minecraft server properties\nmotd=New\nmy.custom=1\npvp=true\nhardcore=true\n'
		);
	});

	it('does not touch the file when nothing differs from the defaults', () => {
		saveServerProperties(id, { pvp: 'true', 'max-players': '20' });
		expect(() => readFileSync(file)).toThrow();
	});

	it('creates the file when it does not exist and a value changes', () => {
		saveServerProperties(id, { 'max-players': '50' });
		expect(readFileSync(file, 'utf8')).toBe('max-players=50\n');
	});

	it('writes a default over a different value already in the file', () => {
		writeFileSync(file, 'pvp=false\n');
		saveServerProperties(id, { pvp: 'true' });
		expect(readFileSync(file, 'utf8')).toBe('pvp=true\n');
	});

	it('can edit a key that is only in the file, but not add a new one', () => {
		writeFileSync(file, 'my.custom=1\n');
		saveServerProperties(id, { 'my.custom': '2' });
		expect(readFileSync(file, 'utf8')).toBe('my.custom=2\n');
		expect(() => saveServerProperties(id, { 'brand.new': '1' })).toThrow(/not a known property/);
	});

	it('refuses managed keys, bad names and invalid values, writing nothing', () => {
		writeFileSync(file, 'motd=Keep\n');
		expect(() => saveServerProperties(id, { 'server-port': '1' })).toThrow(/managed/);
		expect(() => saveServerProperties(id, { 'rcon.password': 'x' })).toThrow(/managed/);
		expect(() => saveServerProperties(id, { 'a b': 'x' })).toThrow(/not a valid/);
		expect(() => saveServerProperties(id, { motd: 'New', 'view-distance': '99' })).toThrow(
			/view-distance/
		);
		expect(() => saveServerProperties(id, { motd: 'a\nops=evil' })).toThrow(/single line/);
		expect(readFileSync(file, 'utf8')).toBe('motd=Keep\n');
	});

	it('round-trips a value with a backslash or colon', () => {
		saveServerProperties(id, { motd: 'C:\\temp: a=b' });
		expect(getServerProperties(id).values.motd).toBe('C:\\temp: a=b');
	});
});
