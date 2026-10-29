// Detached per-instance runner: owns the server process, buffers recent console
// output and serves a local socket so the panel can (re)attach at any time.
// Usage: bun runner/main.ts <instanceDir> <instanceId>
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Socket } from 'bun';
import type { ClientMessage, LaunchSpec, RunnerStatus, ServerMessage } from './protocol';
import { socketPath } from './protocol';

const [dir, id] = process.argv.slice(2);
if (!dir || !id) {
	console.error('usage: runner <instanceDir> <instanceId>');
	process.exit(2);
}

const HISTORY_LINES = 1000;
const STOP_TIMEOUT_MS = 30_000;

const spec: LaunchSpec = JSON.parse(readFileSync(join(dir, 'launch.json'), 'utf8'));
const sock = socketPath(dir, id);
const pidFile = join(dir, 'runner.pid');

const history: string[] = [];
const subscribers = new Set<Socket<{ buf: string; subscribed: boolean }>>();

const send = (s: Socket<unknown>, msg: ServerMessage) => s.write(JSON.stringify(msg) + '\n');
const broadcast = (msg: ServerMessage) => {
	for (const s of subscribers) send(s, msg);
};

function log(line: string) {
	history.push(line);
	if (history.length > HISTORY_LINES) history.shift();
	broadcast({ type: 'log', line });
}

const child = Bun.spawn([spec.command, ...spec.args], {
	cwd: spec.cwd,
	stdin: 'pipe',
	stdout: 'pipe',
	stderr: 'pipe'
});

const status: RunnerStatus = {
	state: 'running',
	pid: child.pid,
	startedAt: Date.now(),
	exitCode: null
};

async function pump(stream: ReadableStream<Uint8Array>) {
	const decoder = new TextDecoder();
	let rest = '';
	for await (const chunk of stream) {
		rest += decoder.decode(chunk, { stream: true });
		const lines = rest.split(/\r?\n/);
		rest = lines.pop() ?? '';
		for (const line of lines) log(line);
	}
	if (rest) log(rest);
}

function cleanup() {
	// a newer runner may already own these files
	if (existsSync(pidFile) && readFileSync(pidFile, 'utf8') !== String(process.pid)) return;
	rmSync(pidFile, { force: true });
	if (process.platform !== 'win32') rmSync(sock, { force: true });
}

let stopTimer: ReturnType<typeof setTimeout> | undefined;

function stop() {
	if (status.state !== 'running') return;
	status.state = 'stopping';
	broadcast({ type: 'status', ...status });
	child.stdin.write('stop\n');
	child.stdin.flush();
	stopTimer = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS);
}

function handle(s: Socket<{ buf: string; subscribed: boolean }>, msg: ClientMessage) {
	switch (msg.type) {
		case 'stdin':
			if (status.state !== 'exited') {
				child.stdin.write(msg.line + '\n');
				child.stdin.flush();
			}
			break;
		case 'stop':
			stop();
			break;
		case 'kill':
			child.kill('SIGKILL');
			break;
		case 'status':
			send(s, { type: 'status', ...status });
			break;
		case 'subscribe':
			s.data.subscribed = true;
			subscribers.add(s);
			for (const line of history) send(s, { type: 'log', line });
			send(s, { type: 'status', ...status });
			break;
	}
}

if (existsSync(sock) && process.platform !== 'win32') rmSync(sock);

Bun.listen<{ buf: string; subscribed: boolean }>({
	unix: sock,
	socket: {
		open(s) {
			s.data = { buf: '', subscribed: false };
		},
		data(s, chunk) {
			s.data.buf += chunk.toString();
			const lines = s.data.buf.split('\n');
			s.data.buf = lines.pop() ?? '';
			for (const line of lines) {
				if (!line) continue;
				try {
					handle(s, JSON.parse(line));
				} catch {
					// ignore malformed client input
				}
			}
		},
		close(s) {
			subscribers.delete(s);
		},
		error() {}
	}
});

writeFileSync(pidFile, String(process.pid));

await Promise.all([pump(child.stdout), pump(child.stderr)]);
status.exitCode = await child.exited;
status.state = 'exited';
clearTimeout(stopTimer);
broadcast({ type: 'status', ...status });

// give subscribers a moment to receive the final status, then go away
setTimeout(() => {
	cleanup();
	process.exit(0);
}, 1000);

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
	// the runner outlives the panel on purpose; only an explicit signal ends it
	process.on(sig, () => {
		child.kill('SIGKILL');
	});
}
