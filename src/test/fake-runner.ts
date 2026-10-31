// An in-memory stand-in for the runner client: a test says whether the server runs. It stands in
// at the one place the panel touches a real process, so tests use the live server module as is.

export const runner = { running: false };

export const fakeRunnerClient = {
	status: async () =>
		runner.running ? { state: 'running', pid: 1, startedAt: 0, exitCode: null } : null,
	send: async () => true,
	subscribe: async () => null
};
