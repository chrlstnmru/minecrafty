// Files the server cannot start without. The file manager refuses to delete, rename or replace
// them (by upload or by creating something of the same name), whatever route the request takes.
// This guards against accidents; it is not a security boundary, the console can do anything.

// at the root of the server folder, compared without regard to case
const ROOT_FILES = new Set([
	'server.jar',
	'fabric-server-launch.jar',
	'quilt-server-launch.jar',
	'eula.txt',
	'run.sh',
	'run.bat'
]);
const ROOT_FOLDERS = new Set(['libraries']);
const FORGE_LAUNCHER = /^forge-.*\.jar$/;

/** One path segment as the filesystem may see it: Windows and macOS ignore case and trailing dots/spaces. */
export const fold = (segment: string) =>
	segment
		.normalize('NFC')
		.toLowerCase()
		.replace(/[. ]+$/, '');

/** Whether a path (relative to the server folder) is, or is inside, a protected entry. */
export function isProtected(rel: string) {
	const [first] = rel.replaceAll('\\', '/').split('/').filter(Boolean).map(fold);
	if (!first) return false;
	return ROOT_FILES.has(first) || ROOT_FOLDERS.has(first) || FORGE_LAUNCHER.test(first);
}

/** Throws a message for the user when `rel` is protected. */
export function assertMutable(rel: string, action: string) {
	if (isProtected(rel))
		throw new Error(
			`${rel.split('/').filter(Boolean)[0]} is part of the server install and cannot be ${action}`
		);
}

// the server keeps these in memory and writes them back, so an edit made while it runs is lost
const REWRITTEN_ON_STOP = new Set([
	'server.properties',
	'ops.json',
	'whitelist.json',
	'banned-players.json',
	'banned-ips.json'
]);

export const isRewrittenOnStop = (rel: string) => {
	const parts = rel.replaceAll('\\', '/').split('/').filter(Boolean);
	return parts.length === 1 && REWRITTEN_ON_STOP.has(fold(parts[0]));
};

/** Whether a path is, or is inside, one of the world folders (`level-name`, plus its Nether and End). */
export function isWorldPath(rel: string, levelName: string) {
	const [first] = rel.replaceAll('\\', '/').split('/').filter(Boolean).map(fold);
	if (!first) return false;
	const level = fold(levelName);
	return first === level || first === `${level}_nether` || first === `${level}_the_end`;
}

/** Changing a world under a running server corrupts it; refuse until the server is stopped. */
export function assertWorldIdle(rel: string, levelName: string, running: boolean, action: string) {
	if (running && isWorldPath(rel, levelName))
		throw new Error(`Stop the server before ${action} the world`);
}
