import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	statfsSync,
	copyFileSync,
	writeSync
} from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './config';
import { prepareTarget, uploadTarget } from './files';
import { CHUNK_BYTES, MAX_FILE_BYTES } from '../upload-limits';

// Chunked uploads. A large file arrives as numbered pieces, each written at its own offset in a
// temporary file that lives outside the instance (so a half-sent file never shows up in the file
// list or a backup). Pieces may arrive in any order and be sent again; the file is only moved into
// place once every piece is there. Sessions live in memory: a restart discards them, and the
// leftover temporary files are swept at startup.

const tmpDir = join(dataDir, 'tmp', 'uploads');
const IDLE_MS = 60 * 60 * 1000;
const MAX_SESSIONS = 32;

type Session = {
	instanceId: number;
	userId: number;
	dirRel: string;
	relPath: string;
	size: number;
	pieces: number;
	received: boolean[];
	tmp: string;
	touched: number;
};

const sessions = new Map<string, Session>();

const pieceLength = (s: Session, index: number) =>
	index === s.pieces - 1 ? s.size - index * CHUNK_BYTES : CHUNK_BYTES;

function forget(id: string) {
	const session = sessions.get(id);
	if (session) rmSync(session.tmp, { force: true });
	sessions.delete(id);
}

/** Discards sessions nobody has touched for an hour. */
export function pruneUploads(now = Date.now()) {
	for (const [id, s] of sessions) if (now - s.touched > IDLE_MS) forget(id);
}

/** At startup no session survives, so whatever is left in the temp folder is garbage. */
export function sweepUploads() {
	sessions.clear();
	rmSync(tmpDir, { recursive: true, force: true });
}

function session(id: string, instanceId: number, userId: number) {
	const s = sessions.get(id);
	// the same answer for "no such upload" and "somebody else's upload"
	if (!s || s.instanceId !== instanceId || s.userId !== userId)
		throw new Error('That upload is no longer available, start it again');
	s.touched = Date.now();
	return s;
}

export function beginUpload(opts: {
	instanceId: number;
	userId: number;
	dirRel: string;
	relPath: string;
	size: number;
}) {
	pruneUploads();
	if (!Number.isSafeInteger(opts.size) || opts.size < 0) throw new Error('Invalid file size');
	if (opts.size > MAX_FILE_BYTES)
		throw new Error(`Files can be at most ${MAX_FILE_BYTES / 1024 ** 3} GB`);
	if (sessions.size >= MAX_SESSIONS)
		throw new Error('Too many uploads in progress, try again soon');

	// the same checks a finished file gets, so a bad path fails before any data is sent
	const target = uploadTarget(opts.instanceId, opts.dirRel, opts.relPath);

	mkdirSync(tmpDir, { recursive: true });
	// refuse early if the disk could not hold the file (with room to spare for the server itself)
	const stats = statfsSync(tmpDir);
	if (opts.size + 256 * 1024 * 1024 > stats.bavail * stats.bsize)
		throw new Error('Not enough free disk space for this file');

	const id = crypto.randomUUID();
	const tmp = join(tmpDir, `${id}.part`);
	closeSync(openSync(tmp, 'w'));
	const pieces = Math.max(1, Math.ceil(opts.size / CHUNK_BYTES));
	sessions.set(id, {
		instanceId: opts.instanceId,
		userId: opts.userId,
		dirRel: opts.dirRel,
		relPath: opts.relPath,
		size: opts.size,
		pieces,
		received: new Array(pieces).fill(false),
		tmp,
		touched: Date.now()
	});
	return { uploadId: id, chunkBytes: CHUNK_BYTES, pieces, shown: target.shown };
}

/** Writes one piece at its position. Sending the same piece twice is harmless. */
export async function writePiece(opts: {
	uploadId: string;
	instanceId: number;
	userId: number;
	index: number;
	piece: Blob;
	sha256?: string;
}) {
	const s = session(opts.uploadId, opts.instanceId, opts.userId);
	if (!Number.isInteger(opts.index) || opts.index < 0 || opts.index >= s.pieces)
		throw new Error('Unexpected piece number');
	if (opts.piece.size !== pieceLength(s, opts.index))
		throw new Error('The piece has the wrong size');

	const hasher = new Bun.CryptoHasher('sha256');
	const fd = openSync(s.tmp, 'r+');
	try {
		let position = opts.index * CHUNK_BYTES;
		for await (const chunk of opts.piece.stream()) {
			hasher.update(chunk);
			let offset = 0;
			while (offset < chunk.length)
				offset += writeSync(fd, chunk, offset, chunk.length - offset, position + offset);
			position += chunk.length;
		}
	} finally {
		closeSync(fd);
	}
	// verified after writing: a bad piece is never marked received, so it gets sent again
	if (opts.sha256 && hasher.digest('hex') !== opts.sha256.toLowerCase())
		throw new Error('The piece was damaged in transit, sending it again');
	s.received[opts.index] = true;
	return { received: s.received.filter(Boolean).length, pieces: s.pieces };
}

/** Which pieces the server already has, so an interrupted upload sends only the rest. */
export function uploadStatus(uploadId: string, instanceId: number, userId: number) {
	const s = session(uploadId, instanceId, userId);
	return { have: s.received.flatMap((got, i) => (got ? [i] : [])), pieces: s.pieces };
}

/** Moves the finished file into place, after checking that all of it arrived. */
export function finishUpload(uploadId: string, instanceId: number, userId: number) {
	const s = session(uploadId, instanceId, userId);
	const missing = s.received.findIndex((got) => !got);
	if (missing !== -1)
		throw new Error(`The file is incomplete (piece ${missing + 1} of ${s.pieces} is missing)`);
	if (!existsSync(s.tmp) || statSync(s.tmp).size !== s.size)
		throw new Error('The file did not arrive intact');

	// checked again now: a link could have appeared in the target folder since the upload began
	const target = uploadTarget(s.instanceId, s.dirRel, s.relPath);
	prepareTarget(s.instanceId, target);
	try {
		renameSync(s.tmp, target.absolute);
	} catch (e) {
		// the temp folder and the instance can sit on different volumes
		if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
		copyFileSync(s.tmp, target.absolute);
		rmSync(s.tmp, { force: true });
	}
	sessions.delete(uploadId);
	return target.shown;
}

export function abortUpload(uploadId: string, instanceId: number, userId: number) {
	session(uploadId, instanceId, userId);
	forget(uploadId);
}

/** For tests and the startup sweep: how many uploads are in flight, and what is on disk. */
export const _debug = () => ({
	sessions: sessions.size,
	files: existsSync(tmpDir) ? readdirSync(tmpDir).length : 0
});
