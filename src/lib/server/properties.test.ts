import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { makeInstance } from '#test/instance.js';

import { propertyFields, propertyGroups, validateProperty } from '../server-properties-catalog';
import { serverDir } from './instances';
import {
	getServerProperties,
	getServerPropertiesText,
	saveServerProperties,
	saveServerPropertiesText
} from './properties';

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

describe('the file as text', () => {
	it('leaves out the managed lines, so the RCON password never leaves the host', () => {
		writeFileSync(file, '#Comment\nmotd=Hi\nrcon.password=secret\nserver-port=25565\npvp=true\n');
		expect(getServerPropertiesText(id)).toEqual({
			exists: true,
			text: '#Comment\nmotd=Hi\npvp=true\n'
		});
	});

	it('saves the text as typed and keeps the managed lines from the file', () => {
		writeFileSync(file, 'motd=Hi\nrcon.password=secret\n');
		expect(saveServerPropertiesText(id, '# mine\nmotd=Bye\nmy.custom=1\n\n')).toBe(true);
		expect(readFileSync(file, 'utf8')).toBe(
			'# mine\nmotd=Bye\nmy.custom=1\nrcon.password=secret\n'
		);
		expect(saveServerPropertiesText(id, '# mine\nmotd=Bye\nmy.custom=1')).toBe(false);
		// Minecraft escapes colons when it writes the file
		expect(saveServerPropertiesText(id, 'level-type=minecraft\\:normal')).toBe(true);
		expect(getServerProperties(id).values['level-type']).toBe('minecraft:normal');
	});

	it('names the line that is wrong and writes nothing', () => {
		writeFileSync(file, 'motd=Keep\n');
		expect(() => saveServerPropertiesText(id, 'motd=a\nnot a pair')).toThrow(/^Line 2: write it/);
		expect(() => saveServerPropertiesText(id, 'rcon.password=x')).toThrow(/Line 1: .*managed/);
		expect(() => saveServerPropertiesText(id, 'pvp=true\npvp=false')).toThrow(
			/already set on line 1/
		);
		expect(() => saveServerPropertiesText(id, 'view-distance=99')).toThrow(
			/Line 1 \(view-distance\)/
		);
		expect(readFileSync(file, 'utf8')).toBe('motd=Keep\n');
	});
});
