import { afterEach, describe, expect, it, vi } from 'vitest';

import { getProjects } from './modrinth';

afterEach(() => vi.unstubAllGlobals());

describe('getProjects', () => {
	it('asks for at most 100 projects a request, each id once, and joins the answers', async () => {
		const asked: string[][] = [];
		vi.stubGlobal('fetch', async (url: URL) => {
			const ids = JSON.parse(url.searchParams.get('ids')!) as string[];
			asked.push(ids);
			return Response.json(ids.map((id) => ({ id })));
		});
		const ids = Array.from({ length: 250 }, (_, i) => `p${i}`);
		const projects = await getProjects([...ids, 'p0', 'p1']);
		expect(asked.map((batch) => batch.length)).toEqual([100, 100, 50]);
		expect(projects.map((p) => p.id)).toEqual(ids);
	});

	it('asks nothing for no ids', async () => {
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		expect(await getProjects([])).toEqual([]);
		expect(fetch).not.toHaveBeenCalled();
	});
});
