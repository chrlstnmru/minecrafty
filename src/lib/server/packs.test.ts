import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeInstance } from '../../test/instance';
import { serverDir } from './instances';
import * as P from './packs';

const propsOf = (id: number) => join(serverDir(id), 'server.properties');

describe('server resource pack options', () => {
	it('writes the require flag and a prompt as a JSON text component', () => {
		const { id } = makeInstance();
		P.setServerPackOptions(id, { required: true, prompt: 'Please accept our pack' });
		const text = readFileSync(propsOf(id), 'utf8');
		expect(text).toContain('require-resource-pack=true');
		expect(text).toContain('resource-pack-prompt="Please accept our pack"');
	});

	it('reads the options back, unwrapping the JSON string', () => {
		const { id } = makeInstance();
		P.setServerPackOptions(id, { required: true, prompt: 'He said "hi" \\o/' });
		expect(P.serverPack(id)).toMatchObject({
			required: true,
			prompt: 'He said "hi" \\o/',
			pack: null,
			externalUrl: null
		});
	});

	it('clears the prompt when it is empty', () => {
		const { id } = makeInstance();
		P.setServerPackOptions(id, { required: false, prompt: '   ' });
		expect(P.serverPack(id)).toMatchObject({ required: false, prompt: '' });
		expect(readFileSync(propsOf(id), 'utf8')).toContain('resource-pack-prompt=\n');
	});

	it('keeps the other lines of server.properties', () => {
		const { id } = makeInstance();
		mkdirSync(serverDir(id), { recursive: true });
		writeFileSync(propsOf(id), '#settings\nmotd=Hello\n');
		P.setServerPackOptions(id, { required: true, prompt: '' });
		expect(readFileSync(propsOf(id), 'utf8')).toContain('#settings\nmotd=Hello\n');
	});

	it('shows a pack URL it did not set as external', () => {
		const { id } = makeInstance();
		mkdirSync(serverDir(id), { recursive: true });
		writeFileSync(propsOf(id), 'resource-pack=https://example.com/pack.zip\n');
		expect(P.serverPack(id).externalUrl).toBe('https://example.com/pack.zip');
	});

	it('refuses an instance that does not exist', () => {
		expect(() => P.setServerPackOptions(999_999, { required: true, prompt: '' })).toThrow(
			/not found/i
		);
	});
});
