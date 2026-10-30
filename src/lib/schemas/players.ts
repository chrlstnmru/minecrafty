import * as v from 'valibot';
import { isIP } from 'node:net';
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

const ip = v.pipe(
	v.string(),
	v.check((value) => isIP(value) !== 0, 'Not a valid IP address')
);

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
