import { openRcon, type RconConnection, type RconTarget } from './rcon';

// One RCON connection per server, kept open between commands. Minecraft logs every connection it
// accepts and closes, so a connection per command fills the console while the Players page polls.

const IDLE_MS = 60_000;

type Session = {
	key: string;
	connection: Promise<RconConnection>;
	idle?: ReturnType<typeof setTimeout>;
};

const sessions = new Map<number, Session>();

const keyOf = (target: RconTarget) => `${target.host ?? ''}:${target.port}:${target.password}`;

function drop(instanceId: number, session: Session) {
	clearTimeout(session.idle);
	if (sessions.get(instanceId) === session) sessions.delete(instanceId);
	session.connection.then((c) => c.close()).catch(() => {});
}

/** The server's open connection, or a new one when there is none, it ended, or RCON moved. */
async function connectionFor(instanceId: number, target: RconTarget, timeoutMs: number) {
	const key = keyOf(target);
	const current = sessions.get(instanceId);
	if (current) {
		if (current.key === key) {
			const connection = await current.connection.catch(() => null);
			if (connection?.open) return { session: current, connection };
		}
		drop(instanceId, current);
	}
	const session: Session = { key, connection: openRcon(target, timeoutMs) };
	sessions.set(instanceId, session);
	try {
		return { session, connection: await session.connection };
	} catch (e) {
		drop(instanceId, session);
		throw e;
	}
}

/**
 * Runs a command on the server's kept connection, opening one when needed. A connection that has
 * ended (the server restarted, say) is replaced before the command is sent, so nothing is sent twice.
 * The connection closes after a minute with no commands.
 */
export async function rconCommand(
	instanceId: number,
	target: RconTarget,
	command: string,
	timeoutMs = 5000
) {
	const { session, connection } = await connectionFor(instanceId, target, timeoutMs);
	clearTimeout(session.idle);
	try {
		return await connection.run(command);
	} finally {
		if (connection.open && sessions.get(instanceId) === session) {
			session.idle = setTimeout(() => drop(instanceId, session), IDLE_MS);
			session.idle.unref?.();
		} else {
			drop(instanceId, session);
		}
	}
}

/** Closes every kept connection; for tests. */
export function closeAllRcon() {
	for (const [id, session] of sessions) drop(id, session);
}
