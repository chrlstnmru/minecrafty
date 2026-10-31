import { describe, expect, it } from 'vitest';

import type { instances } from './db/schema';

import { packSourceOf } from './pack-source';

type Row = typeof instances.$inferSelect;

const row = (fields: Partial<Row>) =>
	({
		name: 'My server',
		packProjectId: null,
		packVersionId: null,
		packVersionNumber: null,
		fromPackId: null,
		fromPackRevision: null,
		...fields
	}) as Row;

describe('packSourceOf', () => {
	it('is none for a server made from a loader alone', () => {
		expect(packSourceOf(row({}))).toBeNull();
	});

	it('follows a Modrinth modpack by project and version', () => {
		const source = packSourceOf(
			row({ packProjectId: 'AANobbMI', packVersionId: 'V1', packVersionNumber: '1.0' })
		)!;
		expect(source).toMatchObject({
			kind: 'modrinth',
			id: 'AANobbMI',
			installedVersionId: 'V1',
			installedLabel: '1.0'
		});
		expect(source.recordVersion({ versionId: 'V2', versionNumber: '2.0' })).toEqual({
			packVersionId: 'V2',
			packVersionNumber: '2.0'
		});
	});

	it('words an unrecorded Modrinth version plainly', () => {
		const source = packSourceOf(row({ packProjectId: 'AANobbMI' }))!;
		expect(source.installedVersionId).toBeNull();
		expect(source.installedLabel).toBe('the old version');
	});

	it('follows a builder pack by id and revision', () => {
		const source = packSourceOf(row({ fromPackId: 7, fromPackRevision: 3 }))!;
		expect(source).toMatchObject({
			kind: 'builder',
			id: 'local:7',
			installedVersionId: 'rev:3',
			installedLabel: 'revision 3'
		});
		expect(source.recordVersion({ versionId: 'rev:5', versionNumber: 'revision 5' })).toEqual({
			fromPackRevision: 5
		});
	});

	it('prefers the Modrinth pack when both are recorded', () => {
		expect(packSourceOf(row({ packProjectId: 'P', fromPackId: 7 }))?.kind).toBe('modrinth');
	});
});
