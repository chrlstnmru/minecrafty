import { rename, rm } from 'node:fs/promises';

export type Hash = { algo: 'sha1' | 'sha256' | 'sha512' | 'md5'; value: string };
export type Download = { url: string; hash?: Hash };

/** Downloads a file, verifying the upstream checksum when one is published. */
export async function downloadFile(dest: string, { url, hash }: Download) {
	const res = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) });
	if (!res.ok) throw new Error(`Download failed (${res.status})`);

	const tmp = `${dest}.part`;
	try {
		await Bun.write(tmp, res);
		if (hash) {
			const actual = new Bun.CryptoHasher(hash.algo)
				.update(await Bun.file(tmp).arrayBuffer())
				.digest('hex');
			if (actual !== hash.value) throw new Error('Downloaded file failed checksum verification');
		}
		await rename(tmp, dest);
	} catch (e) {
		await rm(tmp, { force: true });
		throw e;
	}
}
