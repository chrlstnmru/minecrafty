// In-memory count of failed sign-ins, so a password cannot be guessed at full speed. Lost on restart,
// which is fine: a restart is slow and visible, not something to loop on.

const WINDOW_MS = 15 * 60_000;
/** Failures allowed for one username from one address, then for one address over all usernames. */
const PAIR_LIMIT = 5;
const ADDRESS_LIMIT = 30;

type Count = { failures: number; since: number };

const counts = new Map<string, Count>();

const pairKey = (address: string, username: string) => `${address}\n${username.toLowerCase()}`;

function live(key: string, now: number) {
	const count = counts.get(key);
	if (count && now - count.since >= WINDOW_MS) {
		counts.delete(key);
		return undefined;
	}
	return count;
}

function bump(key: string, now: number) {
	const count = live(key, now) ?? { failures: 0, since: now };
	count.failures++;
	counts.set(key, count);
}

/** How long, in ms, this address must wait before trying this username again; 0 when it may try now. */
export function loginBlockedFor(address: string, username: string, now = Date.now()) {
	let wait = 0;
	for (const [key, limit] of [
		[pairKey(address, username), PAIR_LIMIT],
		[address, ADDRESS_LIMIT]
	] as const) {
		const count = live(key, now);
		if (count && count.failures >= limit) wait = Math.max(wait, count.since + WINDOW_MS - now);
	}
	return wait;
}

export function recordLoginFailure(address: string, username: string, now = Date.now()) {
	bump(pairKey(address, username), now);
	bump(address, now);
	// drop what has run out, so guessing many usernames does not grow the map for ever
	if (counts.size > 10_000) for (const key of counts.keys()) live(key, now);
}

/** A good password clears that username's count; the address count stays, since it spans usernames. */
export function recordLoginSuccess(address: string, username: string) {
	counts.delete(pairKey(address, username));
}

export function resetLoginThrottle() {
	counts.clear();
}
