import { error } from '@sveltejs/kit';

/** A file a change was built on has changed since it was opened. */
export class StaleFile extends Error {
	constructor() {
		super('This file changed since you opened it. Reload it to see the new version.');
	}
}

/**
 * One item of a batch of file changes was refused, so none of them were made. The message starts
 * with the path, and the path and reason also reach the page as fields of the error.
 */
export class ChangeRefused extends Error {
	constructor(
		readonly path: string,
		reason: string,
		readonly kind: 'stale' | 'refused' = 'refused'
	) {
		super(`${path}: ${reason}`);
	}
}

/** `e`, thrown while checking `path`, as the refusal of that item. */
export function refusal(path: string, e: unknown) {
	if (e instanceof ChangeRefused) return e;
	return new ChangeRefused(
		path,
		e instanceof Error ? e.message : 'not allowed',
		e instanceof StaleFile ? 'stale' : 'refused'
	);
}

/** Runs the checks for one item of a batch, so a refusal names the item it is about. */
export async function refusedAs<T>(path: string, check: () => T | Promise<T>): Promise<T> {
	try {
		return await check();
	} catch (e) {
		throw refusal(path, e);
	}
}

/** Turns a service error into a 400 whose message the UI can show (missing jar, already running, ...). */
export async function userFacing<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e; // already an HttpError
		if (e instanceof ChangeRefused)
			error(400, { message: e.message, path: e.path, reason: e.kind });
		error(400, e instanceof Error ? e.message : 'Something went wrong');
	}
}
