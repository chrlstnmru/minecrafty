/** Where the dev server's socket listens; Vite forwards the socket path to it. */
export const DEV_SOCKET_PORT = Number(process.env.MINECRAFTY_DEV_SOCKET_PORT ?? 24680);
