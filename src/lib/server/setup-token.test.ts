import { existsSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import * as S from './setup-token';

beforeEach(() => S.clearSetupToken());

describe('setup code', () => {
	it('is made once, saved in the data folder, and kept until cleared', () => {
		const code = S.setupToken();
		expect(code).toMatch(/^[0-9a-f]{4}(-[0-9a-f]{4}){4}$/);
		expect(readFileSync(S.setupTokenFile(), 'utf8').trim()).toBe(code);
		expect(S.setupToken()).toBe(code);
		S.clearSetupToken();
		expect(existsSync(S.setupTokenFile())).toBe(false);
		expect(S.setupToken()).not.toBe(code);
	});

	it('accepts the code typed with other case, spaces or no dashes, and nothing else', () => {
		const code = S.setupToken();
		expect(S.checkSetupToken(code)).toBe(true);
		expect(S.checkSetupToken(` ${code.toUpperCase().replaceAll('-', ' ')} `)).toBe(true);
		expect(S.checkSetupToken(code.replaceAll('-', ''))).toBe(true);
		expect(S.checkSetupToken(code.slice(0, -1) + (code.endsWith('0') ? '1' : '0'))).toBe(false);
		expect(S.checkSetupToken('')).toBe(false);
	});
});
