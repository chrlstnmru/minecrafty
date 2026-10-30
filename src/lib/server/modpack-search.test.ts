import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModrinthHit } from './modrinth';

const modrinth = vi.hoisted(() => ({ search: vi.fn() }));

vi.mock('./modrinth', async (original) => ({
	...(await original<typeof import('./modrinth')>()),
	searchProjects: modrinth.search
}));

const { searchModpacks } = await import('./modpacks');

const hit = (title: string, server_side: string) => ({ title, server_side }) as ModrinthHit;

/** A fake Modrinth with `all` as its results, served in pages the way the real one does. */
function serve(all: ModrinthHit[]) {
	modrinth.search.mockImplementation(async (opts?: { offset?: number; limit?: number }) => {
		const offset = opts?.offset ?? 0;
		return { hits: all.slice(offset, offset + (opts?.limit ?? 20)), total_hits: all.length };
	});
}

beforeEach(() => modrinth.search.mockReset());

describe('searchModpacks', () => {
	const mixed = [
		hit('Server pack', 'required'),
		hit('FPS pack', 'unsupported'),
		hit('Optional pack', 'optional'),
		hit('Launcher bundle', 'unsupported')
	];

	it('leaves out packs the result marks as client-only', async () => {
		serve(mixed);
		const { hits } = await searchModpacks('', 20);
		expect(hits.map((h) => h.title)).toEqual(['Server pack', 'Optional pack']);
	});

	it('includes them when asked', async () => {
		serve(mixed);
		const { hits } = await searchModpacks('', 20, true);
		expect(hits).toHaveLength(4);
	});

	it('does not rely on the search facet, which lets client-only packs through', async () => {
		serve(mixed);
		await searchModpacks('', 20);
		expect(modrinth.search).toHaveBeenCalledWith(expect.objectContaining({ serverSide: false }));
	});

	it('keeps reading pages until the list is full, even when many are client-only', async () => {
		const all = Array.from({ length: 400 }, (_, i) =>
			hit(`pack ${i}`, i % 3 === 0 ? 'required' : 'unsupported')
		);
		serve(all);
		const { hits, more } = await searchModpacks('', 20);
		expect(hits).toHaveLength(20);
		expect(hits.every((h) => h.server_side === 'required')).toBe(true);
		expect(more).toBe(true);
	});

	it('says there is no more once the search is exhausted', async () => {
		serve(mixed);
		expect((await searchModpacks('', 20)).more).toBe(false);
	});

	it('stops after a few pages rather than reading all of Modrinth for a rare match', async () => {
		serve(Array.from({ length: 5000 }, (_, i) => hit(`pack ${i}`, 'unsupported')));
		const { hits, more } = await searchModpacks('', 20);
		expect(hits).toEqual([]);
		expect(more).toBe(true);
		expect(modrinth.search.mock.calls.length).toBeLessThanOrEqual(5);
	});
});
