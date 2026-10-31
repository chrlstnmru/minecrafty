import {
	closeSync,
	createReadStream,
	createWriteStream,
	fstatSync,
	mkdirSync,
	openSync,
	readSync
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { crc32, createInflateRaw } from 'node:zlib';

import { safeEntryName } from '#lib/safe-entry-name.js';

// Extracts a zip straight from disk, one entry at a time, so restoring a large backup never
// holds it in memory. Every name is checked before anything is written, and each file's size
// and CRC must match what the archive declares. Zip64 and encrypted entries are refused.

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_ENTRIES = 0xffff;

type Entry = {
	name: string;
	flags: number;
	method: number;
	crc: number;
	compressedSize: number;
	size: number;
	offset: number;
	isDir: boolean;
};

function readAt(fd: number, position: number, length: number) {
	const buffer = Buffer.alloc(length);
	let done = 0;
	while (done < length) {
		const n = readSync(fd, buffer, done, length - done, position + done);
		if (n === 0) throw new Error('The zip file is truncated');
		done += n;
	}
	return buffer;
}

function readDirectory(fd: number): Entry[] {
	const fileSize = fstatSync(fd).size;
	const tailLength = Math.min(fileSize, 22 + 0xffff);
	const tail = readAt(fd, fileSize - tailLength, tailLength);
	let eocd = -1;
	for (let i = tail.length - 22; i >= 0; i--) {
		if (tail.readUInt32LE(i) === EOCD) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error('Not a valid zip file');

	const count = tail.readUInt16LE(eocd + 10);
	const dirSize = tail.readUInt32LE(eocd + 12);
	const dirOffset = tail.readUInt32LE(eocd + 16);
	if (count === 0xffff || dirOffset === 0xffffffff)
		throw new Error('Zip64 files are not supported');
	if (count > MAX_ENTRIES) throw new Error('The zip has too many entries');

	const directory = readAt(fd, dirOffset, dirSize);
	const entries: Entry[] = [];
	let at = 0;
	for (let i = 0; i < count; i++) {
		if (at + 46 > directory.length || directory.readUInt32LE(at) !== CENTRAL)
			throw new Error('The zip file is damaged');
		const nameLength = directory.readUInt16LE(at + 28);
		const extraLength = directory.readUInt16LE(at + 30);
		const commentLength = directory.readUInt16LE(at + 32);
		const name = directory.toString('utf8', at + 46, at + 46 + nameLength);
		entries.push({
			name,
			flags: directory.readUInt16LE(at + 8),
			method: directory.readUInt16LE(at + 10),
			crc: directory.readUInt32LE(at + 16),
			compressedSize: directory.readUInt32LE(at + 20),
			size: directory.readUInt32LE(at + 24),
			offset: directory.readUInt32LE(at + 42),
			isDir: name.endsWith('/')
		});
		at += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

/** Checks the CRC and size of what flows through, and refuses more than the archive declared. */
function verifier(entry: Entry) {
	let crc = 0;
	let size = 0;
	return new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			size += chunk.length;
			if (size > entry.size) return callback(new Error(`${entry.name} is larger than declared`));
			crc = crc32(chunk, crc);
			callback(null, chunk);
		},
		flush(callback) {
			if (size !== entry.size || crc !== entry.crc)
				return callback(new Error(`${entry.name} is corrupt`));
			callback();
		}
	});
}

/**
 * Extracts every entry of `zipPath` into `destination`, which should be empty or new. Nothing
 * outside it is ever written. Returns how many files were written.
 */
export async function extractZip(zipPath: string, destination: string) {
	const root = resolve(destination);
	mkdirSync(root, { recursive: true });
	const fd = openSync(zipPath, 'r');
	try {
		const entries = readDirectory(fd);
		const planned = entries.map((entry) => {
			const name = safeEntryName(entry.name);
			if (!name) throw new Error(`Unsafe path in the archive: ${entry.name}`);
			const target = resolve(root, name);
			if (!target.startsWith(root + sep))
				throw new Error(`Unsafe path in the archive: ${entry.name}`);
			if (entry.flags & 1) throw new Error(`${entry.name} is encrypted`);
			if (!entry.isDir && entry.method !== 0 && entry.method !== 8)
				throw new Error(`${entry.name} uses an unsupported compression method`);
			return { entry, target };
		});

		let files = 0;
		for (const { entry, target } of planned) {
			if (entry.isDir) {
				mkdirSync(target, { recursive: true });
				continue;
			}
			mkdirSync(dirname(target), { recursive: true });
			const header = readAt(fd, entry.offset, 30);
			if (header.readUInt32LE(0) !== LOCAL) throw new Error('The zip file is damaged');
			const start = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);

			const out = createWriteStream(target, { flags: 'wx' });
			if (entry.compressedSize === 0 && entry.size === 0) {
				out.end();
				await finished(out);
			} else {
				const source = createReadStream(zipPath, {
					start,
					end: start + entry.compressedSize - 1
				});
				const stages =
					entry.method === 8
						? [source, createInflateRaw(), verifier(entry), out]
						: [source, verifier(entry), out];
				await pipeline(stages as [typeof source, ...Transform[], typeof out]);
			}
			files++;
		}
		return files;
	} finally {
		closeSync(fd);
	}
}
