/**
 * A relative path that cannot leave the folder it is joined onto, normalised, or null:
 * no absolute paths, drive letters, backslashes, NUL bytes or `..` segments.
 */
export function safeEntryName(name: string) {
	if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/')) return null;
	if (/^[a-zA-Z]:/.test(name)) return null;
	const parts = name.split('/').filter((part) => part !== '' && part !== '.');
	if (!parts.length || parts.includes('..')) return null;
	return parts.join('/');
}
