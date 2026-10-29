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
const fold = (segment: string) =>
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
