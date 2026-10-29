/** Names the logs viewer serves: plain or gzip-rotated logs, never a path. */
export const LOG_NAME = /^[A-Za-z0-9][\w.-]{0,120}\.log(\.gz)?$/;

export const TAIL_LINES = 2000;
