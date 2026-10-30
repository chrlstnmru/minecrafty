// A one-time code that first-run setup asks for, so the first visitor to reach a fresh panel cannot
// make themselves the owner. It is printed to the log and kept in the data folder, where the
// install scripts read it back, and it is deleted once the owner exists.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { dataDir } from './config';

export const setupTokenFile = () => join(dataDir, 'setup-token.txt');

/** Typing the code may add spaces or dashes, or change the case. */
const normalize = (code: string) => code.replace(/[\s-]/g, '').toLowerCase();

/** The current code, made on first use and kept across restarts until setup is done. */
export function setupToken() {
	const file = setupTokenFile();
	if (existsSync(file)) return readFileSync(file, 'utf8').trim();
	const hex = Buffer.from(crypto.getRandomValues(new Uint8Array(10))).toString('hex');
	const code = hex.match(/.{4}/g)!.join('-');
	mkdirSync(dataDir, { recursive: true });
	writeFileSync(file, code + '\n', { mode: 0o600 });
	return code;
}

export function checkSetupToken(given: string) {
	const want = Buffer.from(normalize(setupToken()));
	const got = Buffer.from(normalize(given));
	return got.length === want.length && timingSafeEqual(got, want);
}

export function clearSetupToken() {
	rmSync(setupTokenFile(), { force: true });
}

/** Prints the code where whoever installed the panel will look: the console, or the service log. */
export function announceSetupToken() {
	const code = setupToken();
	console.log(
		[
			'',
			'  Minecrafty is not set up yet. Open /setup and enter this setup code:',
			'',
			`      ${code}`,
			'',
			`  It is also in ${setupTokenFile()}`,
			''
		].join('\n')
	);
}
