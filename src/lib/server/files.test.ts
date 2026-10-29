import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeInstance } from '../../test/instance';
import * as F from './files';
import { serverDir } from './instances';

// Every path the file manager accepts comes from the browser, so these tests are mostly about what
// must be refused: leaving the instance folder by `..`, absolute paths, or a symlink.

let id: number;
let root: string;
let outside: string;

beforeEach(() => {
	id = makeInstance().id;
	root = serverDir(id);
	outside = mkdtempSync(join(tmpdir(), 'outside-'));
	writeFileSync(join(outside, 'secret.txt'), 'SECRET');
	mkdirSync(root, { recursive: true });
});

describe('paths that must be refused', () => {
	const bad = [
		'../x',
		'a/../../x',
		'/etc/passwd',
		'C:\\Windows',
		'a\\..\\..\\x',
		'..',
		'sub/../../..',
		'a\0b'
	];

	it.each(bad)('list %j', (path) => {
		expect(() => F.listDirectory(id, path)).toThrow();
	});

	it('read, write, mkdir and delete outside the folder', () => {
		expect(() => F.readTextFile(id, '../../../etc/passwd')).toThrow();
		expect(() => F.writeTextFile(id, '../escape.txt', 'x')).toThrow();
		expect(() => F.makeDirectory(id, '..', 'escape')).toThrow();
		expect(() => F.deleteEntry(id, '../..')).toThrow();
	});
});

describe('symlinks pointing outside the instance', () => {
	beforeEach(() => symlinkSync(outside, join(root, 'link')));

	it('cannot be listed, read, written, created in, deleted from or uploaded into', async () => {
		expect(() => F.listDirectory(id, 'link')).toThrow(/leaves the instance/);
		expect(() => F.readTextFile(id, 'link/secret.txt')).toThrow(/leaves the instance/);
		expect(() => F.writeTextFile(id, 'link/new.txt', 'x')).toThrow(/leaves the instance/);
		expect(() => F.makeDirectory(id, 'link', 'sub')).toThrow(/leaves the instance/);
		expect(() => F.deleteEntry(id, 'link/secret.txt')).toThrow(/leaves the instance/);
		await expect(F.saveUpload(id, 'link', new File(['x'], 'u.txt'))).rejects.toThrow(
			/leaves the instance/
		);
	});

	it('leaves the outside folder untouched', () => {
		expect(() => F.deleteEntry(id, 'link/secret.txt')).toThrow();
		expect(readdirSync(outside)).toEqual(['secret.txt']);
		expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('SECRET');
	});

	it('shows up in a listing as a link and is skipped by a folder download', () => {
		writeFileSync(join(root, 'real.txt'), 'inside');
		const link = F.listDirectory(id, '').entries.find((e) => e.name === 'link');
		expect(link?.kind).toBe('link');

		const download = F.describeDownload(id, '');
		expect(download.kind).toBe('folder');
		if (download.kind === 'folder')
			expect(download.entries.map((e) => e.name)).toEqual(['real.txt']);
	});

	it('a link that stays inside the instance is fine', () => {
		mkdirSync(join(root, 'target'));
		writeFileSync(join(root, 'target', 'a.txt'), 'ok');
		symlinkSync(join(root, 'target'), join(root, 'inner'));
		expect(F.readTextFile(id, 'inner/a.txt').content).toBe('ok');
	});
});

describe('listing', () => {
	it('puts folders first, then sorts names naturally and case-insensitively', () => {
		mkdirSync(join(root, 'zdir'));
		mkdirSync(join(root, 'Adir'));
		for (const name of ['b.txt', 'A.txt', 'file10.txt', 'file2.txt'])
			writeFileSync(join(root, name), '');
		const names = F.listDirectory(id, '').entries.map((e) => e.name);
		expect(names).toEqual(['Adir', 'zdir', 'A.txt', 'b.txt', 'file2.txt', 'file10.txt']);
	});

	it('reports kind, size and a modified time', () => {
		writeFileSync(join(root, 'a.txt'), '12345');
		const [entry] = F.listDirectory(id, '').entries;
		expect(entry).toMatchObject({ name: 'a.txt', kind: 'file', size: 5 });
		expect(entry.modified).toBeGreaterThan(0);
	});

	it('normalises the path it returns and refuses a file as a folder', () => {
		mkdirSync(join(root, 'a'));
		writeFileSync(join(root, 'f.txt'), '');
		expect(F.listDirectory(id, 'a/').path).toBe('a');
		expect(() => F.listDirectory(id, 'f.txt')).toThrow(/Not a folder/);
	});
});

describe('text files', () => {
	it('round-trips through write and read', () => {
		F.writeTextFile(id, 'config/a.toml', 'key = "value"\n');
		expect(F.readTextFile(id, 'config/a.toml').content).toBe('key = "value"\n');
	});

	it('only edits known text types', () => {
		expect(() => F.writeTextFile(id, 'run.sh', 'x')).toThrow(/cannot be edited/);
		expect(() => F.writeTextFile(id, 'mod.jar', 'x')).toThrow(/cannot be edited/);
		for (const name of [
			'a.properties',
			'a.json',
			'a.TOML',
			'a.yml',
			'a.yaml',
			'a.cfg',
			'a.txt',
			'a.mcmeta',
			'a.snbt'
		])
			expect(F.isEditable(name)).toBe(true);
	});

	it('refuses binary content and files over the size limit', () => {
		writeFileSync(join(root, 'blob.json'), Buffer.from([1, 2, 0, 3]));
		expect(() => F.readTextFile(id, 'blob.json')).toThrow(/binary/);
		writeFileSync(join(root, 'big.txt'), 'x'.repeat(F.MAX_EDIT_BYTES + 1));
		expect(() => F.readTextFile(id, 'big.txt')).toThrow(/too large/);
		expect(() => F.writeTextFile(id, 'big.txt', 'x'.repeat(F.MAX_EDIT_BYTES + 1))).toThrow(
			/too large/
		);
	});
});

describe('creating, renaming and deleting', () => {
	it('creates folders and refuses duplicates', () => {
		F.makeDirectory(id, '', 'config');
		expect(existsSync(join(root, 'config'))).toBe(true);
		expect(() => F.makeDirectory(id, '', 'config')).toThrow(/already exists/);
	});

	it('creates empty text files only for editable types', () => {
		F.createTextFile(id, '', 'notes.txt');
		expect(readFileSync(join(root, 'notes.txt'), 'utf8')).toBe('');
		expect(() => F.createTextFile(id, '', 'run.sh')).toThrow(/cannot be edited/);
		expect(() => F.createTextFile(id, '', 'notes.txt')).toThrow(/already exists/);
	});

	it.each(['../b.txt', 'a/b.txt', 'a\\b.txt', '..', '.', '', 'x'.repeat(256)])(
		'a new name is one plain name, not %j',
		(name) => {
			writeFileSync(join(root, 'a.txt'), '');
			expect(() => F.renameEntry(id, 'a.txt', name)).toThrow();
			expect(() => F.makeDirectory(id, '', name)).toThrow();
		}
	);

	it('renames within the folder and refuses to overwrite', () => {
		mkdirSync(join(root, 'config'));
		writeFileSync(join(root, 'config', 'a.toml'), 'k');
		writeFileSync(join(root, 'config', 'taken.toml'), '');
		F.renameEntry(id, 'config/a.toml', 'b.toml');
		expect(existsSync(join(root, 'config', 'b.toml'))).toBe(true);
		expect(existsSync(join(root, 'config', 'a.toml'))).toBe(false);
		expect(() => F.renameEntry(id, 'config/b.toml', 'taken.toml')).toThrow(/already exists/);
	});

	it('deletes files and whole folders', () => {
		mkdirSync(join(root, 'world', 'region'), { recursive: true });
		writeFileSync(join(root, 'world', 'region', 'r.mca'), 'x');
		F.deleteEntry(id, 'world');
		expect(existsSync(join(root, 'world'))).toBe(false);
	});

	it('never renames or deletes the instance folder itself', () => {
		expect(() => F.renameEntry(id, '', 'x')).toThrow(/cannot be renamed/);
		expect(() => F.deleteEntry(id, '')).toThrow(/cannot be deleted/);
		expect(existsSync(root)).toBe(true);
	});

	it('refuses an instance that does not exist', () => {
		expect(() => F.listDirectory(999_999, '')).toThrow(/not found/i);
	});
});

describe('small uploads', () => {
	it('saves into the folder under the file name and replaces a file of the same name', async () => {
		mkdirSync(join(root, 'mods'));
		await F.saveUpload(id, 'mods', new File(['one'], 'a.jar'));
		await F.saveUpload(id, 'mods', new File(['two'], 'a.jar'));
		expect(readFileSync(join(root, 'mods', 'a.jar'), 'utf8')).toBe('two');
	});

	it('builds the folders of a dropped folder from the relative path', async () => {
		await F.saveUpload(id, '', new File(['x'], 'a.jar'), 'pack/mods/a.jar');
		expect(readFileSync(join(root, 'pack', 'mods', 'a.jar'), 'utf8')).toBe('x');
	});

	it('reduces a file name that carries a path to a refusal, never to a write outside', async () => {
		await expect(F.saveUpload(id, '', new File(['x'], '../evil.txt'))).rejects.toThrow();
		await expect(F.saveUpload(id, '', new File(['x'], 'x.txt'), '../evil.txt')).rejects.toThrow();
		await expect(F.saveUpload(id, '', new File(['x'], 'x.txt'), '/etc/evil.txt')).rejects.toThrow(
			/not allowed/
		);
		await expect(F.saveUpload(id, '', new File(['x'], 'x.txt'), 'C:\\evil.txt')).rejects.toThrow(
			/not allowed/
		);
		await expect(F.saveUpload(id, '', new File(['x'], 'x.txt'), '///')).rejects.toThrow();
		expect(existsSync(join(root, '..', 'evil.txt'))).toBe(false);
	});

	it('refuses to write a file over a folder', async () => {
		mkdirSync(join(root, 'taken'));
		await expect(F.saveUpload(id, '', new File(['x'], 'taken'))).rejects.toThrow(/is a folder/);
	});

	it('writes the real bytes, not a description of the object', async () => {
		const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
		await F.saveUpload(id, '', new File([bytes], 'bytes.bin'));
		expect(Buffer.from(readFileSync(join(root, 'bytes.bin'))).equals(Buffer.from(bytes))).toBe(
			true
		);
	});

	it('rejects a file too big for a batch', async () => {
		const huge = {
			name: 'huge.bin',
			size: 1024 ** 3,
			stream: () => new Blob([]).stream()
		} as unknown as File;
		await expect(F.saveUpload(id, '', huge)).rejects.toThrow(/sent in pieces/);
	});
});

describe('downloads', () => {
	it('describes a file as a file and a folder as a zip of its contents', () => {
		mkdirSync(join(root, 'world', 'region'), { recursive: true });
		writeFileSync(join(root, 'world', 'level.dat'), 'x');
		writeFileSync(join(root, 'world', 'region', 'r.mca'), 'y');
		writeFileSync(join(root, 'eula.txt'), 'eula=true');

		const file = F.describeDownload(id, 'eula.txt');
		expect(file).toMatchObject({ kind: 'file', name: 'eula.txt' });

		const folder = F.describeDownload(id, 'world');
		expect(folder.kind).toBe('folder');
		if (folder.kind === 'folder') {
			expect(folder.name).toBe('world.zip');
			expect(folder.entries.map((e) => e.name).sort()).toEqual([
				'level.dat',
				'region',
				'region/r.mca'
			]);
		}
	});

	it('names a whole-instance download "server.zip" and refuses paths outside', () => {
		const all = F.describeDownload(id, '');
		expect(all.kind === 'folder' && all.name).toBe('server.zip');
		expect(() => F.describeDownload(id, '../..')).toThrow();
	});
});
