import { createReadStream } from 'node:fs';
import { createDeflateRaw, crc32 } from 'node:zlib';

// A streaming zip writer: nothing is held in memory beyond one chunk, so a world folder can be
// downloaded or backed up without buffering it. Entries use a data descriptor (sizes and CRC come
// after the data), which lets files be compressed while they are read. Zip64 is not supported:
// archives are limited to 65535 entries and 4 GiB.

export type ZipEntry =
	| { kind: 'dir'; name: string; modified: Date }
	| { kind: 'file'; name: string; path: string; modified: Date };

const LIMIT = 0xffffffff;
const encoder = new TextEncoder();

function dosDateTime(date: Date) {
	const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
	const day =
		((Math.max(date.getFullYear(), 1980) - 1980) << 9) |
		((date.getMonth() + 1) << 5) |
		date.getDate();
	return { time, day };
}

/** A fixed-size header, followed by the entry name when there is one. */
function record(headerSize: number, write: (view: DataView) => void, name = new Uint8Array(0)) {
	const bytes = new Uint8Array(headerSize + name.length);
	write(new DataView(bytes.buffer));
	bytes.set(name, headerSize);
	return bytes;
}

/** Streams one file through deflate, tracking its CRC and sizes for the data descriptor. */
async function* deflateFile(path: string, result: { crc: number; size: number; packed: number }) {
	const deflate = createDeflateRaw();
	const source = createReadStream(path);
	source.on('data', (chunk) => {
		result.crc = crc32(chunk as Buffer, result.crc);
		result.size += (chunk as Buffer).length;
	});
	source.on('error', (e) => deflate.destroy(e));
	source.pipe(deflate);
	for await (const chunk of deflate) {
		result.packed += (chunk as Buffer).length;
		yield chunk as Buffer;
	}
}

export async function* zipChunks(entries: ZipEntry[]): AsyncGenerator<Uint8Array> {
	if (entries.length > 0xffff) throw new Error('Too many files for a zip archive');

	const central: Uint8Array[] = [];
	let offset = 0;
	const emit = (bytes: Uint8Array) => {
		offset += bytes.length;
		return bytes;
	};

	for (const entry of entries) {
		const name = encoder.encode(
			entry.kind === 'dir' ? entry.name.replace(/\/?$/, '/') : entry.name
		);
		const { time, day } = dosDateTime(entry.modified);
		const isFile = entry.kind === 'file';
		const flags = isFile ? 0x0808 : 0x0800; // bit 3: data descriptor, bit 11: UTF-8 names
		const method = isFile ? 8 : 0;
		const headerOffset = offset;

		yield emit(
			record(
				30,
				(v) => {
					v.setUint32(0, 0x04034b50, true);
					v.setUint16(4, 20, true);
					v.setUint16(6, flags, true);
					v.setUint16(8, method, true);
					v.setUint16(10, time, true);
					v.setUint16(12, day, true);
					v.setUint16(26, name.length, true);
				},
				name
			)
		);

		const result = { crc: 0, size: 0, packed: 0 };
		if (isFile) {
			for await (const chunk of deflateFile(entry.path, result)) yield emit(chunk);
			if (result.size > LIMIT || result.packed > LIMIT || offset > LIMIT)
				throw new Error('The archive is too large for a zip (4 GiB limit)');
			yield emit(
				record(16, (v) => {
					v.setUint32(0, 0x08074b50, true);
					v.setUint32(4, result.crc, true);
					v.setUint32(8, result.packed, true);
					v.setUint32(12, result.size, true);
				})
			);
		}

		central.push(
			record(
				46,
				(v) => {
					v.setUint32(0, 0x02014b50, true);
					v.setUint16(4, 20, true);
					v.setUint16(6, 20, true);
					v.setUint16(8, flags, true);
					v.setUint16(10, method, true);
					v.setUint16(12, time, true);
					v.setUint16(14, day, true);
					v.setUint32(16, result.crc, true);
					v.setUint32(20, result.packed, true);
					v.setUint32(24, result.size, true);
					v.setUint16(28, name.length, true);
					v.setUint32(38, isFile ? 0 : 0x10, true); // external attributes: directory bit
					v.setUint32(42, headerOffset, true);
				},
				name
			)
		);
	}

	const directoryOffset = offset;
	for (const entry of central) yield emit(entry);
	const directorySize = offset - directoryOffset;
	yield record(22, (v) => {
		v.setUint32(0, 0x06054b50, true);
		v.setUint16(8, entries.length, true);
		v.setUint16(10, entries.length, true);
		v.setUint32(12, directorySize, true);
		v.setUint32(16, directoryOffset, true);
	});
}

/** The archive as a web stream, ready to be a `Response` body. */
export function zipStream(entries: ZipEntry[]): ReadableStream<Uint8Array> {
	const chunks = zipChunks(entries);
	return new ReadableStream({
		async pull(controller) {
			try {
				const next = await chunks.next();
				if (next.done) controller.close();
				else controller.enqueue(next.value);
			} catch (e) {
				controller.error(e);
			}
		},
		cancel() {
			void chunks.return(undefined);
		}
	});
}
