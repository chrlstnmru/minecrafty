import { describe, expect, it } from 'vitest';

import { canRetryInstall, isFromPack, originOf } from './instance-origin';

const loader = { packProjectId: null, fromPackId: null };
const modrinth = { packProjectId: 'AANobbMI', fromPackId: null };
const builder = { packProjectId: null, fromPackId: 7 };

describe('originOf', () => {
	it('tells the three kinds of server apart', () => {
		expect(originOf(loader)).toBe('loader');
		expect(originOf(modrinth)).toBe('modrinth-pack');
		expect(originOf(builder)).toBe('builder-pack');
	});

	it('treats missing columns as a loader-only server', () => {
		expect(originOf({})).toBe('loader');
	});

	it('counts a builder pack with id 0 as a pack', () => {
		expect(originOf({ fromPackId: 0 })).toBe('builder-pack');
	});
});

describe('what the origin allows', () => {
	it('follows a pack for both kinds of pack', () => {
		expect(isFromPack(loader)).toBe(false);
		expect(isFromPack(modrinth)).toBe(true);
		expect(isFromPack(builder)).toBe(true);
	});

	it('retries only a loader-only install', () => {
		expect(canRetryInstall(loader)).toBe(true);
		expect(canRetryInstall(modrinth)).toBe(false);
		expect(canRetryInstall(builder)).toBe(false);
	});
});
