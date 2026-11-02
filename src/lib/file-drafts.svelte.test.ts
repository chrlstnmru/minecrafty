import { flushSync, tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	FileDrafts,
	type DraftsAdapter,
	type FileRead,
	type FileText,
	type Leaving
} from './file-drafts.svelte';

function reactive<T>(value: T) {
	const box = $state(value);
	return box;
}

/** Files on a pretend server, read and saved through the drafts' adapter. */
function server(files: Record<string, string>) {
	const disk = new Map(Object.entries(files));
	let version = 0;
	const hashOf = (path: string) => `${path}@${disk.get(path)}`;
	const reads = new Map<string, { current: FileText | undefined }>();

	function read(path: string): FileRead | null {
		if (!disk.has(path)) return null;
		const live =
			reads.get(path) ?? reactive({ current: { content: disk.get(path)!, hash: hashOf(path) } });
		reads.set(path, live);
		return {
			get current() {
				return live.current;
			},
			error: undefined,
			loading: false,
			refresh: async () => {
				live.current = { content: disk.get(path)!, hash: hashOf(path) };
			},
			then: (ok, fail) =>
				Promise.resolve({ content: disk.get(path)!, hash: hashOf(path) }).then(ok, fail)
		};
	}

	const report = vi.fn();
	const disposed: string[] = [];
	const save = vi.fn<DraftsAdapter['save']>(async (drafts) => {
		if (!drafts.length) return null;
		for (const draft of drafts)
			if (!draft.isNew && draft.hash !== hashOf(draft.path))
				throw {
					status: 400,
					body: {
						message: `${draft.path}: This file changed since you opened it`,
						path: draft.path,
						reason: 'stale'
					}
				};
		for (const draft of drafts) disk.set(draft.path, draft.content);
		version++;
		return {
			hashes: Object.fromEntries(drafts.map((d) => [d.path, hashOf(d.path)])),
			count: drafts.length
		};
	});
	const adapter: DraftsAdapter = {
		read,
		save,
		report,
		models: { dispose: (key) => disposed.push(key), disposeAll: (prefix) => disposed.push(prefix) }
	};
	return {
		adapter,
		disk,
		report,
		save,
		disposed,
		get version() {
			return version;
		},
		/** Someone else writes the file. */
		write: (path: string, text: string) => disk.set(path, text)
	};
}

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

/** Drafts made inside an effect root, as a component would make them. */
function drafts(adapter: DraftsAdapter) {
	let made!: FileDrafts;
	cleanup = $effect.root(() => {
		made = new FileDrafts('test', adapter);
	});
	flushSync();
	return made;
}

/** Opens `path` and lets its text load. */
function opened(d: FileDrafts, path: string) {
	d.show(path);
	flushSync();
	return d.byPath[path];
}

describe('opening files', () => {
	it('loads the text, and an edit makes the file unsaved', () => {
		const s = server({ 'a.toml': 'a = 1' });
		const d = drafts(s.adapter);
		const draft = opened(d, 'a.toml');
		expect(draft).toMatchObject({ content: 'a = 1', loaded: 'a = 1', hash: 'a.toml@a = 1' });
		expect(d.unsavedPaths).toEqual([]);

		draft.content = 'a = 2';
		flushSync();
		expect(d.unsavedPaths).toEqual(['a.toml']);
		expect(d.dirty('a.toml')).toBe(true);
	});

	it('keeps each file’s edit when switching between them', () => {
		const s = server({ 'a.toml': 'a', 'b.toml': 'b' });
		const d = drafts(s.adapter);
		opened(d, 'a.toml').content = 'a!';
		opened(d, 'b.toml').content = 'b!';
		d.show('a.toml');
		flushSync();
		expect(d.current?.content).toBe('a!');
		expect(d.unsavedPaths.sort()).toEqual(['a.toml', 'b.toml']);
	});

	it('a new file is unsaved until saved, and has nothing to read', async () => {
		const s = server({});
		const d = drafts(s.adapter);
		d.show('new.toml', { created: true });
		flushSync();
		expect(d.file).toBeNull();
		expect(d.unsavedPaths).toEqual(['new.toml']);

		d.current!.content = 'x = 1';
		expect(await d.saveAll()).toEqual({ saved: 1 });
		flushSync();
		expect(s.disk.get('new.toml')).toBe('x = 1');
		expect(d.byPath['new.toml'].isNew).toBe(false);
		expect(d.unsavedPaths).toEqual([]);
	});
});

describe('saving', () => {
	it('sends only the unsaved drafts, or only those asked for', async () => {
		const s = server({ 'a.toml': 'a', 'b.toml': 'b', 'c.toml': 'c' });
		const d = drafts(s.adapter);
		opened(d, 'a.toml').content = 'a!';
		opened(d, 'b.toml').content = 'b!';
		opened(d, 'c.toml');

		expect(await d.saveAll(['b.toml'])).toEqual({ saved: 1 });
		expect(s.save.mock.calls[0][0].map((draft) => draft.path)).toEqual(['b.toml']);
		expect(s.save.mock.calls[0][1]).toEqual(['b.toml']);
		flushSync();
		expect(d.unsavedPaths).toEqual(['a.toml']);

		expect(await d.saveAll()).toEqual({ saved: 1 });
		expect(s.disk.get('a.toml')).toBe('a!');
	});

	it('keeps edits made while the save was going out', async () => {
		const s = server({ 'a.toml': 'a' });
		const d = drafts(s.adapter);
		const draft = opened(d, 'a.toml');
		draft.content = 'first';
		const saving = d.saveAll();
		expect(d.saving).toBe(true);
		draft.content = 'second';
		await saving;
		flushSync();
		expect(s.disk.get('a.toml')).toBe('first');
		expect(d.unsavedPaths).toEqual(['a.toml']);
		expect(d.saving).toBe(false);
	});

	it('names a file that changed since it was opened, and reading it again clears that', async () => {
		const s = server({ 'a.toml': 'a' });
		const d = drafts(s.adapter);
		opened(d, 'a.toml').content = 'mine';
		s.write('a.toml', 'theirs');

		const result = await d.saveAll();
		expect(result).toEqual({
			failed: {
				message: 'a.toml: This file changed since you opened it',
				path: 'a.toml',
				stale: true
			}
		});
		expect(d.failedPath).toBe('a.toml');
		expect(d.saveError).toMatch(/changed since/);

		await d.refetch('a.toml');
		flushSync();
		expect(d.byPath['a.toml']).toMatchObject({ content: 'theirs', loaded: 'theirs' });
		expect(d.failedPath).toBeUndefined();
		expect(d.saveError).toBeUndefined();
	});

	it('reads a stale file again when it is put back', async () => {
		const s = server({ 'a.toml': 'a' });
		const d = drafts(s.adapter);
		opened(d, 'a.toml').content = 'mine';
		s.write('a.toml', 'theirs');
		await d.saveAll();

		d.revert('a.toml');
		await vi.waitFor(() => expect(d.byPath['a.toml'].content).toBe('theirs'));
		expect(d.failedPath).toBeUndefined();
	});

	it('shows a refused path where the editor says the file is now', async () => {
		const s = server({ 'old.toml': 'a' });
		const d = drafts({ ...s.adapter, shownAt: (path) => path.replace('old', 'new') });
		opened(d, 'old.toml').content = 'mine';
		s.write('old.toml', 'theirs');
		await d.saveAll();
		expect(d.failedPath).toBe('new.toml');
	});
});

describe('moving and deleting files', () => {
	it('moves the drafts of a folder, and the open file, keeping their editor keys', () => {
		const s = server({ 'config/a.toml': 'a', 'config/sub/b.toml': 'b', 'configs.toml': 'c' });
		const d = drafts(s.adapter);
		opened(d, 'config/a.toml').content = 'a!';
		opened(d, 'config/sub/b.toml');
		opened(d, 'configs.toml');
		const keys = ['config/a.toml', 'config/sub/b.toml'].map((path) => d.modelKey(path));

		d.rekey('config', 'moved');
		expect(Object.keys(d.byPath).sort()).toEqual([
			'configs.toml',
			'moved/a.toml',
			'moved/sub/b.toml'
		]);
		expect([d.modelKey('moved/a.toml'), d.modelKey('moved/sub/b.toml')]).toEqual(keys);
		expect(d.byPath['moved/a.toml'].content).toBe('a!');
		expect(s.disposed).toEqual([]);

		d.show('moved/sub/b.toml');
		d.rekey('moved/sub', 'deep');
		expect(d.open).toBe('deep/b.toml');
	});

	it('drops the drafts of a folder, closes it in the editor, and frees their editor texts', () => {
		const s = server({ 'config/a.toml': 'a', 'b.toml': 'b' });
		const d = drafts(s.adapter);
		opened(d, 'b.toml');
		opened(d, 'config/a.toml');
		const key = d.modelKey('config/a.toml');

		d.drop('config');
		expect(Object.keys(d.byPath)).toEqual(['b.toml']);
		expect(d.open).toBeNull();
		expect(s.disposed).toEqual([key]);
	});

	it('gives a file made where a deleted one was a fresh editor text', () => {
		const s = server({ 'a.toml': 'a' });
		const d = drafts(s.adapter);
		opened(d, 'a.toml');
		const old = d.modelKey('a.toml');
		d.drop('a.toml');
		d.show('a.toml', { created: true });
		expect(d.modelKey('a.toml')).not.toBe(old);
	});

	it('drops a new file that is put back, and frees its editor text', () => {
		const s = server({});
		const d = drafts(s.adapter);
		d.show('new.toml', { created: true });
		const key = d.modelKey('new.toml');
		d.revert('new.toml');
		expect(d.byPath['new.toml']).toBeUndefined();
		expect(d.open).toBeNull();
		expect(s.disposed).toEqual([key]);
	});
});

describe('discarding and leaving', () => {
	const navigation = (to: string, type: Leaving['type'] = 'link') => {
		const cancel = vi.fn();
		return {
			cancel,
			from: { url: new URL('http://panel/instances/1/files') },
			to: { url: new URL(`http://panel${to}`) },
			type
		} as unknown as Leaving & { cancel: ReturnType<typeof vi.fn> };
	};

	it('counts what the editor keeps waiting besides the drafts', () => {
		const s = server({ 'a.toml': 'a' });
		let staged = $state(2);
		const d = drafts({ ...s.adapter, count: (unsaved) => unsaved.length + staged });
		expect(d.changeCount).toBe(2);
		opened(d, 'a.toml').content = 'a!';
		flushSync();
		expect(d.changeCount).toBe(3);
		staged = 0;
		expect(d.changeCount).toBe(1);
	});

	it('discarding everything takes back the drafts and what the editor keeps waiting', () => {
		const s = server({ 'a.toml': 'a' });
		const onDiscardAll = vi.fn();
		const d = drafts({ ...s.adapter, onDiscardAll });
		opened(d, 'a.toml').content = 'a!';
		d.show('new.toml', { created: true });
		const then = vi.fn();

		d.askDiscardAll(then);
		expect(d.discarding).toMatchObject({ all: true });
		d.discard();
		flushSync();
		expect(onDiscardAll).toHaveBeenCalled();
		expect(then).toHaveBeenCalled();
		expect(d.discarding).toBeNull();
		expect(d.byPath['a.toml'].content).toBe('a');
		expect(d.byPath['new.toml']).toBeUndefined();
		expect(d.unsavedPaths).toEqual([]);
	});

	it('asks before leaving the page with changes, then goes on', () => {
		const s = server({ 'a.toml': 'a' });
		const d = drafts(s.adapter);
		const go = vi.fn();

		const clean = navigation('/instances/1/console');
		d.leave(clean, go);
		expect(clean.cancel).not.toHaveBeenCalled();

		opened(d, 'a.toml').content = 'a!';
		flushSync();
		const sameFolder = navigation('/instances/1/files?path=config');
		d.leave(sameFolder, go);
		expect(sameFolder.cancel).not.toHaveBeenCalled();

		const away = navigation('/instances/1/console');
		d.leave(away, go);
		expect(away.cancel).toHaveBeenCalled();
		expect(d.discarding?.all).toBe(true);
		d.discard();
		expect(go).toHaveBeenCalledWith(new URL('http://panel/instances/1/console'));

		opened(d, 'a.toml').content = 'again';
		flushSync();
		const closing = navigation('/elsewhere', 'leave');
		d.leave(closing, go);
		expect(closing.cancel).toHaveBeenCalled();
		expect(d.discarding).toBeNull();
	});

	it('frees every editor text when the page goes, once an editor was shown', async () => {
		const s = server({ 'a.toml': 'a' });
		const d = drafts(s.adapter);
		d.destroy();
		expect(s.disposed).toEqual([]);
		opened(d, 'a.toml');
		d.destroy();
		await tick();
		expect(s.disposed).toEqual(['test/']);
	});
});

describe('formatting', () => {
	it('tidies the open file, and reports a file it cannot read', async () => {
		const s = server({ 'a.json': '{"a":1}', 'b.json': '{' });
		const d = drafts(s.adapter);
		opened(d, 'a.json');
		await d.format();
		expect(d.current?.content).toBe('{\n  "a": 1\n}');

		opened(d, 'b.json');
		await d.format();
		expect(s.report).toHaveBeenCalled();
		expect(d.current?.content).toBe('{');
	});
});
