// Shared by the server and the browser: how an upload is cut up. Small files go several to a
// request; a bigger file is sent in pieces, so no request is ever larger than a batch.

/** the size of one piece of a large file */
export const CHUNK_BYTES = 4 * 1024 * 1024;
/** files up to this size travel in batches; bigger ones are sent in pieces */
export const SMALL_FILE_BYTES = 8 * 1024 * 1024;
/** the most a batch of small files may hold */
export const BATCH_BYTES = 32 * 1024 * 1024;
export const BATCH_FILES = 200;
/** the largest single file the file manager accepts */
export const MAX_FILE_BYTES = 10 * 1024 ** 3;
