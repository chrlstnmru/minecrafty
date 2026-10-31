// What the in-browser text editors (instance files, pack config files) accept. Client-safe.

export const MAX_EDIT_BYTES = 2 * 1024 * 1024;

// the text formats a server's configuration comes in
const EDITABLE =
	/\.(properties|json|json5|jsonc|toml|ya?ml|cfg|conf|ini|txt|mcmeta|xml|md|snbt|log)$/i;

export const isEditable = (name: string) => EDITABLE.test(name);

export function assertEditableSize(size: number) {
	if (size > MAX_EDIT_BYTES) throw new Error('This file is too large to edit here (2 MB limit)');
}

/** The text of a file's bytes, refusing one too large or binary to edit as text. */
export function decodeText(bytes: Uint8Array) {
	assertEditableSize(bytes.length);
	if (bytes.includes(0)) throw new Error('This looks like a binary file');
	// keep a byte order mark in the text, so a save writes the file back as it was
	return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
}
