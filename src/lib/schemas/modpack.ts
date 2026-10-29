import * as v from 'valibot';

export const importModpackSchema = v.object({
	versionId: v.pipe(v.string(), v.minLength(1, 'Choose a modpack version')),
	name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Enter a name'), v.maxLength(64)),
	port: v.pipe(
		v.number(),
		v.integer(),
		v.minValue(1024, 'Use a port from 1024'),
		v.maxValue(65535)
	),
	ramMaxMb: v.pipe(v.number(), v.integer(), v.minValue(512, 'At least 512 MB'), v.maxValue(131072)),
	eulaAccepted: v.pipe(
		v.optional(v.boolean(), false),
		v.check((accepted) => accepted, 'You must accept the Minecraft EULA')
	)
});
