// Runs before the server starts.
//
// 1. The compiled binary is both the panel and the per-server runner: started as
//    `minecrafty runner <instanceDir> <id>` it becomes the runner and never starts the panel (no
//    web server, no database, no scheduler). Under Bun the runner is a script, so this does not
//    apply there.
// 2. The adapter builds each request's origin as https unless a header names the scheme, because
//    it assumes TLS ends at a proxy; opened as plain http://host:3000, every form and command
//    would then fail the cross-site check. So, unless PROTOCOL_HEADER is set, the scheme comes from
//    the proxy's X-Forwarded-Proto if it sent one and is http otherwise.
if (process.argv[2] === 'runner') {
	await import('../runner/main');
	// the module above keeps the process alive through its sockets; hold the panel back for good
	await new Promise<never>(() => {});
} else if (!process.env.PROTOCOL_HEADER) {
	const header = 'x-minecrafty-scheme';
	process.env.PROTOCOL_HEADER = header;

	const serve = Bun.serve.bind(Bun) as (options: object) => unknown;
	Bun.serve = ((options: { fetch?: (request: Request, server: unknown) => unknown }) => {
		const handle = options.fetch;
		if (!handle) return serve(options);
		return serve({
			...options,
			fetch: (request: Request, server: unknown) => {
				// set on the request itself: the adapter hands this same object back to the server for
				// per-request timeouts, which a copy would not match
				const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
				request.headers.set(header, forwarded || 'http');
				return handle(request, server);
			}
		});
	}) as typeof Bun.serve;
}
