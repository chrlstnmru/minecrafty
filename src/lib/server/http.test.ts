import { describe, expect, it } from 'vitest';

import { ChangeRefused, refusedAs, StaleFile, userFacing } from './http';

const bodyOf = async (run: () => Promise<unknown>) => {
	try {
		await run();
	} catch (e) {
		return e as { status: number; body: App.Error };
	}
	throw new Error('did not throw');
};

describe('refused changes', () => {
	it('name the item a check failed on, and mark a stale file', async () => {
		await expect(
			refusedAs('a.txt', () => {
				throw new Error('not found');
			})
		).rejects.toMatchObject({ path: 'a.txt', kind: 'refused', message: 'a.txt: not found' });
		await expect(
			refusedAs('b.txt', () => {
				throw new StaleFile();
			})
		).rejects.toMatchObject({ path: 'b.txt', kind: 'stale' });
	});

	it('keep the path of a refusal raised inside the check', async () => {
		await expect(
			refusedAs('dir', () => {
				throw new ChangeRefused('dir/c.txt', 'already exists');
			})
		).rejects.toMatchObject({ path: 'dir/c.txt' });
	});

	it('reach the page with their path and reason', async () => {
		const refused = await bodyOf(() =>
			userFacing(async () => {
				throw new ChangeRefused('a.txt', 'This file changed', 'stale');
			})
		);
		expect(refused.status).toBe(400);
		expect(refused.body).toMatchObject({
			message: 'a.txt: This file changed',
			path: 'a.txt',
			reason: 'stale'
		});

		const plain = await bodyOf(() =>
			userFacing(async () => {
				throw new Error('Instance is not running');
			})
		);
		expect(plain.body.message).toBe('Instance is not running');
		expect(plain.body.path).toBeUndefined();
	});
});
