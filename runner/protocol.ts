// Wire protocol between the panel and a runner. Newline-delimited JSON over a local socket.
// Kept free of app imports: the runner is a standalone Bun script.

export type RunnerState = 'running' | 'stopping' | 'exited';

export type RunnerStatus = {
	state: RunnerState;
	pid: number;
	startedAt: number;
	exitCode: number | null;
};

export type ClientMessage =
	| { type: 'stdin'; line: string }
	| { type: 'stop' }
	| { type: 'kill' }
	| { type: 'status' }
	| { type: 'subscribe' };

export type ServerMessage = ({ type: 'status' } & RunnerStatus) | { type: 'log'; line: string };

// what the panel writes to <instance>/launch.json before spawning a runner
export type LaunchSpec = {
	command: string;
	args: string[];
	cwd: string;
};

export function socketPath(dir: string, id: string | number) {
	return process.platform === 'win32' ? `\\\\.\\pipe\\minecrafty-${id}` : `${dir}/runner.sock`;
}
