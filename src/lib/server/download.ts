import { rename, rm } from 'node:fs/promises';

export type Hash = { algo: 'sha1' | 'sha256' | 'sha512' | 'md5'; value: string };
export type Download = { url: string; hash?: Hash };

/** Called as bytes arrive: how many so far, and how many in all (0 when the server does not say). */
export type OnProgress = (done: number, total: number) => void;

const REPORT_EVERY_MS = 200;

/** Downloads a file, verifying the upstream checksum when one is published. */
export async function downloadFile(dest: string, { url, hash }: Download, onProgress?: OnProgress) {
	const res = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) });
	if (!res.ok) throw new Error(`Download failed (${res.status})`);

	const tmp = `${dest}.part`;
	try {
		const total = Number(res.headers.get('content-length')) || 0;
		if (!res.body || !onProgress) await Bun.write(tmp, res);
		else {
			const writer = Bun.file(tmp).writer();
			let done = 0;
			let reported = 0;
			for await (const chunk of res.body) {
				writer.write(chunk);
				done += chunk.length;
				// every chunk would flood whoever is listening; a few times a second is plenty
				if (Date.now() - reported >= REPORT_EVERY_MS) {
					reported = Date.now();
					onProgress(done, total);
				}
			}
			await writer.end();
			onProgress(done, total || done);
		}
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
