import * as v from 'valibot';

import { LOADERS } from '../loader-list.js';
import { idSchema } from './common.js';

const name = v.pipe(v.string(), v.trim(), v.minLength(1, 'Enter a name'), v.maxLength(64));
const port = v.pipe(
	v.number(),
	v.integer(),
	v.minValue(1024, 'Use a port from 1024'),
	v.maxValue(65535)
);
const ramMaxMb = v.pipe(
	v.number(),
	v.integer(),
	v.minValue(512, 'At least 512 MB'),
	v.maxValue(131072)
);

export const createInstanceSchema = v.object({
	name,
	loader: v.picklist(LOADERS),
	mcVersion: v.pipe(v.string(), v.trim(), v.minLength(1, 'Choose a Minecraft version')),
	port,
	ramMaxMb,
	eulaAccepted: v.pipe(
		v.optional(v.boolean(), false),
		v.check((accepted) => accepted, 'You must accept the Minecraft EULA')
	)
});

export const updateInstanceSchema = v.pipe(
	v.object({
		id: idSchema,
		name,
		port,
		ramMinMb: v.pipe(
			v.number(),
			v.integer(),
			v.minValue(256, 'At least 256 MB'),
			v.maxValue(131072)
		),
		ramMaxMb,
		// '' means auto: pick from the Minecraft version
		javaMajor: v.pipe(
			v.picklist(['', '8', '17', '21', '25']),
			v.transform((value) => (value ? Number(value) : null))
		),
		jvmArgs: v.pipe(v.string(), v.maxLength(1000), v.regex(/^[^\r\n]*$/, 'Use a single line')),
		autoStart: v.optional(v.boolean(), false)
	}),
	v.forward(
		v.partialCheck(
			[['ramMinMb'], ['ramMaxMb']],
			(input) => input.ramMinMb <= input.ramMaxMb,
			'Minimum cannot exceed maximum'
		),
		['ramMinMb']
	)
);
