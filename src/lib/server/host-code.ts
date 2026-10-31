// Files that Java, the loader or the operating system would run as code. Someone who can put one
// in a server folder can run anything on the host as the panel's user, which is more than any
// per-server permission is meant to give, so only the owner may add or change them.
import type { Actor } from './access';

import { fold } from './protected-files';

const CODE_EXTENSIONS = /\.(jar|class|sh|bat|cmd|ps1|exe|dll|so|dylib)$/;
// Forge and NeoForge read extra JVM arguments from this file at the root of the server
const CODE_NAMES = new Set(['user_jvm_args.txt']);

/** Whether the last segment of a path is a file the server would run as code. */
export function isHostCode(rel: string) {
	const name = rel.replaceAll('\\', '/').split('/').filter(Boolean).at(-1);
	if (!name) return false;
	const folded = fold(name);
	return CODE_EXTENSIONS.test(folded) || CODE_NAMES.has(folded);
}

/** Throws a message for the user when someone other than the owner would add or change code. */
export function assertMayWriteCode(actor: Actor, rel: string) {
	if (actor.role !== 'owner' && isHostCode(rel))
		throw new Error(
			`Only the owner may add or change ${rel.replaceAll('\\', '/').split('/').filter(Boolean).at(-1)}: the server runs it as code on this machine`
		);
}
