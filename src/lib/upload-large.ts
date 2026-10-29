import {
	abortUpload,
	beginUpload,
	finishUpload,
	uploadPiece,
	uploadProgress
} from '#lib/files.remote.js';
import type { UploadItem } from './upload-entries.js';
import { CHUNK_BYTES } from './upload-limits.js';

// Sends one large file as numbered pieces, a few at a time. A piece that fails is retried, and a
// file that still fails keeps its server-side upload, so trying again sends only what is missing.

const CONCURRENCY = 3;
const RETRIES = 3;
// a piece that has not been acknowledged by now is treated as stalled and sent again
const PIECE_TIMEOUT_MS = 120_000;

export type LargeTarget = { instanceId: number; path: string };

// upload id per file, kept so a retry resumes instead of starting over
const sessions = new Map<string, string>();
const keyOf = (item: UploadItem, target: LargeTarget) =>
	[target.instanceId, target.path, item.path, item.file.size, item.file.lastModified].join('|');

/** Rejects when `promise` takes longer than `ms`; the late request is left to finish on its own. */
function within<T>(promise: Promise<T>, ms: number) {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('Upload stalled')), ms);
		promise.then(
			(value) => (clearTimeout(timer), resolve(value)),
			(error) => (clearTimeout(timer), reject(error))
		);
	});
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** SHA-256 of a piece when the browser can (crypto.subtle needs HTTPS or localhost). */
async function digest(blob: Blob) {
	if (!globalThis.crypto?.subtle) return undefined;
	const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
	return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Gives up on a file for good (it was removed from the queue, or the upload was cancelled). */
export async function discardLarge(item: UploadItem, target: LargeTarget) {
	const key = keyOf(item, target);
	const uploadId = sessions.get(key);
	sessions.delete(key);
	if (uploadId) await abortUpload({ id: target.instanceId, uploadId }).catch(() => undefined);
}

export async function uploadLarge(
	item: UploadItem,
	target: LargeTarget,
	onBytes: (sent: number, total: number) => void,
	signal: AbortSignal,
	/** wait before the first retry; doubles each time (a parameter so tests need not wait) */
	retryDelayMs = 400,
	pieceTimeoutMs = PIECE_TIMEOUT_MS
) {
	const { file } = item;
	const total = file.size;
	const pieces = Math.max(1, Math.ceil(total / CHUNK_BYTES));
	const lengthOf = (index: number) => Math.min(CHUNK_BYTES, total - index * CHUNK_BYTES);
	const key = keyOf(item, target);

	// resume what the server already has, if this file was started before
	let uploadId = sessions.get(key);
	let have = new Set<number>();
	if (uploadId) {
		try {
			have = new Set((await uploadProgress({ id: target.instanceId, uploadId })).have);
		} catch {
			uploadId = undefined; // the server forgot it (an hour idle, or a restart)
		}
	}
	if (!uploadId) {
		({ uploadId } = await beginUpload({
			id: target.instanceId,
			path: target.path,
			name: item.path,
			size: total
		}));
		sessions.set(key, uploadId);
		have = new Set();
	}
	const id = uploadId;

	let sent = [...have].reduce((sum, index) => sum + lengthOf(index), 0);
	onBytes(sent, total);

	const todo = Array.from({ length: pieces }, (_, i) => i).filter((i) => !have.has(i));
	const worker = async () => {
		for (let index = todo.shift(); index !== undefined; index = todo.shift()) {
			for (let attempt = 0; ; attempt++) {
				if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
				try {
					const start = index * CHUNK_BYTES;
					const blob = file.slice(start, start + lengthOf(index));
					const sha256 = await digest(blob);
					await within(
						uploadPiece({
							id: target.instanceId,
							uploadId: id,
							index,
							// a File wraps the slice without copying it; commands carry Files, not bare Blobs
							piece: new File([blob], 'piece'),
							sha256
						}),
						pieceTimeoutMs
					);
					sent += blob.size;
					onBytes(sent, total);
					break;
				} catch (e) {
					if (attempt >= RETRIES) throw e;
					await wait(retryDelayMs * 2 ** attempt);
				}
			}
		}
	};

	try {
		await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
		if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
		await finishUpload({ id: target.instanceId, uploadId: id, path: target.path });
		sessions.delete(key);
	} catch (e) {
		// a cancelled upload is dropped; any other failure keeps the session so Retry can resume
		if (signal.aborted) await discardLarge(item, target);
		throw e;
	}
}
