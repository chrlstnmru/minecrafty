import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { Zip } from './zip';

/** A one-entry zip assembled by hand, so the reader can be fed odd or hostile values. */
function zipOf(opts: {
	name?: string;
	content?: Uint8Array;
	method?: 0 | 8;
	declaredSize?: number;
	flags?: number;
}) {
	const name = new TextEncoder().encode(opts.name ?? 'a.txt');
	const raw = opts.content ?? new TextEncoder().encode('hello');
	const packed = opts.method === 0 ? raw : deflateRawSync(raw);
	const size = opts.declaredSize ?? raw.length;
	const flags = opts.flags ?? 0;

	const local = new Uint8Array(30 + name.length);
	const lv = new DataView(local.buffer);
	lv.setUint32(0, 0x04034b50, true);
	lv.setUint16(8, opts.method ?? 8, true);
	lv.setUint16(26, name.length, true);
	local.set(name, 30);

	const central = new Uint8Array(46 + name.length);
	const cv = new DataView(central.buffer);
	cv.setUint32(0, 0x02014b50, true);
	cv.setUint16(8, flags, true);
	cv.setUint16(10, opts.method ?? 8, true);
	cv.setUint32(20, packed.length, true);
	cv.setUint32(24, size, true);
	cv.setUint16(28, name.length, true);
	cv.setUint32(42, 0, true);
	central.set(name, 46);

	const end = new Uint8Array(22);
	const ev = new DataView(end.buffer);
	ev.setUint32(0, 0x06054b50, true);
	ev.setUint16(8, 1, true);
	ev.setUint16(10, 1, true);
	ev.setUint32(12, central.length, true);
	ev.setUint32(16, local.length + packed.length, true);

	return new Uint8Array([...local, ...packed, ...central, ...end]);
}

describe('zip reader', () => {
	it('reads deflated and stored entries', () => {
		const deflated = new Zip(
			zipOf({ content: new TextEncoder().encode('deflated text'), method: 8 })
		);
		expect(new TextDecoder().decode(deflated.read(deflated.entries[0]))).toBe('deflated text');

		const stored = new Zip(zipOf({ content: new TextEncoder().encode('stored text'), method: 0 }));
		expect(new TextDecoder().decode(stored.read(stored.entries[0]))).toBe('stored text');
	});

	it('finds entries by name and flags folders', () => {
		const zip = new Zip(zipOf({ name: 'dir/', content: new Uint8Array(0), method: 0 }));
		expect(zip.find('dir/')?.isDir).toBe(true);
		expect(zip.find('missing')).toBeUndefined();
	});

	it('returns an empty file without asking the inflater for a zero-size limit', () => {
		const zip = new Zip(zipOf({ content: new Uint8Array(0), method: 8 }));
		expect(zip.read(zip.entries[0]).length).toBe(0);
	});

	it('rejects data that is not a zip', () => {
		expect(() => new Zip(new TextEncoder().encode('this is not a zip file at all'))).toThrow(
			/valid zip/i
		);
		expect(() => new Zip(new Uint8Array(0))).toThrow();
	});

	it('rejects a damaged central directory', () => {
		const good = zipOf({});
		const damaged = good.slice();
		// the central directory signature sits right after the local entry
		const at = damaged.findIndex(
			(_, i) => new DataView(damaged.buffer).getUint32(i, true) === 0x02014b50
		);
		damaged[at] = 0;
		expect(() => new Zip(damaged)).toThrow(/damaged/);
	});

	it('refuses encrypted entries', () => {
		const zip = new Zip(zipOf({ flags: 1 }));
		expect(() => zip.read(zip.entries[0])).toThrow(/encrypted/);
	});

	it('does not inflate past the declared size (zip bomb guard)', () => {
		const bomb = new Uint8Array(5_000_000); // compresses to a few KB
		const zip = new Zip(zipOf({ content: bomb, declaredSize: 100 }));
		expect(() => zip.read(zip.entries[0])).toThrow();
	});

	it('rejects an entry whose real size differs from the declared one', () => {
		const zip = new Zip(
			zipOf({ content: new TextEncoder().encode('twelve bytes'), declaredSize: 20 })
		);
		expect(() => zip.read(zip.entries[0])).toThrow(/corrupt/);
	});

	it('refuses unsupported compression methods', () => {
		const data = zipOf({ method: 8 });
		const zip = new Zip(data);
		zip.entries[0].method = 12; // bzip2
		expect(() => zip.read(zip.entries[0])).toThrow(/unsupported compression/);
	});
});
