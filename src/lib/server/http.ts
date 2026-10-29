import { error } from '@sveltejs/kit';

/** Turns a service error into a 400 whose message the UI can show (missing jar, already running, ...). */
export async function userFacing<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e; // already an HttpError
		error(400, e instanceof Error ? e.message : 'Something went wrong');
	}
}
