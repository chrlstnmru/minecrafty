import { inflateRawSync } from 'node:zlib';

// A small zip reader, so imports work without an unzip tool (Windows has none). It reads the
// central directory and inflates entries on demand; Zip64 and encrypted entries are refused.

export type ZipEntry = {
	name: string;
	/** uncompressed size as declared by the archive */
	size: number;
	compressedSize: number;
	method: number;
	flags: number;
	offset: number;
	isDir: boolean;
};

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_ENTRIES = 50_000;

export class Zip {
	readonly entries: ZipEntry[] = [];
	private view: DataView;

	constructor(private data: Uint8Array) {
		this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);

		let eocd = -1;
		const lowest = Math.max(0, data.length - 22 - 0xffff);
		for (let i = data.length - 22; i >= lowest; i--) {
			if (this.view.getUint32(i, true) === EOCD) {
				eocd = i;
				break;
			}
		}
		if (eocd < 0) throw new Error('Not a valid zip file');

		const count = this.view.getUint16(eocd + 10, true);
		const dirOffset = this.view.getUint32(eocd + 16, true);
		if (count === 0xffff || dirOffset === 0xffffffff)
			throw new Error('Zip64 files are not supported');
		if (count > MAX_ENTRIES) throw new Error('The zip has too many entries');

		let at = dirOffset;
		for (let i = 0; i < count; i++) {
			if (at + 46 > data.length || this.view.getUint32(at, true) !== CENTRAL)
				throw new Error('The zip file is damaged');
			const nameLength = this.view.getUint16(at + 28, true);
			const extraLength = this.view.getUint16(at + 30, true);
			const commentLength = this.view.getUint16(at + 32, true);
			const name = new TextDecoder().decode(data.subarray(at + 46, at + 46 + nameLength));
			this.entries.push({
				name,
				flags: this.view.getUint16(at + 8, true),
				method: this.view.getUint16(at + 10, true),
				compressedSize: this.view.getUint32(at + 20, true),
				size: this.view.getUint32(at + 24, true),
				offset: this.view.getUint32(at + 42, true),
				isDir: name.endsWith('/')
			});
			at += 46 + nameLength + extraLength + commentLength;
		}
	}

	find(name: string) {
		return this.entries.find((e) => e.name === name);
	}

	/** Reads one entry. The inflated size must match what the archive declares. */
	read(entry: ZipEntry): Uint8Array {
		if (entry.flags & 1) throw new Error(`${entry.name} is encrypted`);
		const at = entry.offset;
		if (at + 30 > this.data.length || this.view.getUint32(at, true) !== LOCAL)
			throw new Error('The zip file is damaged');
		const start = at + 30 + this.view.getUint16(at + 26, true) + this.view.getUint16(at + 28, true);
		const raw = this.data.subarray(start, start + entry.compressedSize);
		if (raw.length !== entry.compressedSize) throw new Error('The zip file is truncated');

		let out: Uint8Array;
		// empty files are common (placeholder configs); the inflater rejects a limit of 0
		if (entry.size === 0) return new Uint8Array(0);
		if (entry.method === 0) out = raw;
		else if (entry.method === 8)
			// maxOutputLength stops a zip bomb from inflating past what it declared
			out = inflateRawSync(raw, { maxOutputLength: entry.size });
		else throw new Error(`${entry.name} uses an unsupported compression method`);

		if (out.length !== entry.size) throw new Error(`${entry.name} is corrupt`);
		return out;
	}
}
