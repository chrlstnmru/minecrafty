import * as v from 'valibot';
import { idSchema } from './common.js';

/** A Java name (3 to 16 letters, digits and underscores), or a Bedrock one behind the "." prefix Floodgate adds. */
export const playerName = v.pipe(
	v.string(),
	v.regex(/^\.?[A-Za-z0-9_]{1,16}$/, 'Not a valid player name')
);

const reason = v.optional(
	v.pipe(
		v.string(),
		v.trim(),
		v.maxLength(200, 'At most 200 characters'),
		// a reason goes into a command: no line breaks or other control characters
		v.check(
			(value) => ![...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127),
			'Use a single line'
		)
	)
);

/** An IPv4 or IPv6 address. Not `node:net`, so the page can run the same check as the server. */
export function isIpAddress(value: string) {
	const four = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (four)
		return four.slice(1).every((part) => Number(part) <= 255 && String(Number(part)) === part);
	// the URL parser knows every shape of IPv6; the character check keeps out zone ids and brackets
	if (!value.includes(':') || !/^[0-9a-fA-F:.]+$/.test(value)) return false;
	try {
		return new URL(`http://[${value}]/`).hostname.length > 0;
	} catch {
		return false;
	}
}

const ip = v.pipe(v.string(), v.check(isIpAddress, 'Not a valid IP address'));

export const playerActionSchema = v.object({
	id: idSchema,
	action: v.variant('type', [
		v.object({ type: v.literal('whitelist-add'), name: playerName }),
		v.object({ type: v.literal('whitelist-remove'), name: playerName }),
		v.object({ type: v.literal('op'), name: playerName }),
		v.object({ type: v.literal('deop'), name: playerName }),
		v.object({ type: v.literal('ban'), name: playerName, reason }),
		v.object({ type: v.literal('pardon'), name: playerName }),
		v.object({ type: v.literal('kick'), name: playerName, reason }),
		v.object({ type: v.literal('ban-ip'), ip, reason }),
		v.object({ type: v.literal('pardon-ip'), ip })
	])
});

export type PlayerAction = v.InferOutput<typeof playerActionSchema>['action'];
