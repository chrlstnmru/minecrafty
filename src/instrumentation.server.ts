// Runs before the server starts. The compiled binary is both the panel and the per-server runner:
// started as `minecrafty runner <instanceDir> <id>` it becomes the runner and never starts the
// panel (no web server, no database, no scheduler). Under Bun the runner is a script instead, so
// nothing here applies.
if (process.argv[2] === 'runner') {
	await import('../runner/main');
	// the module above keeps the process alive through its sockets; hold the panel back for good
	await new Promise<never>(() => {});
}
