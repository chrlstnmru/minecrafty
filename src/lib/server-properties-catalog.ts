/** The `server.properties` keys the panel gives a form field. Values are strings, as in the file. */
export type PropertyField = {
	key: string;
	label: string;
	description?: string;
	default: string;
} & (
	| { type: 'boolean' }
	| { type: 'number'; min: number; max: number }
	| { type: 'text' }
	| { type: 'select'; options: { value: string; label: string }[] }
);

export type PropertyGroup = { title: string; description: string; fields: PropertyField[] };

const bool = (key: string, label: string, def: boolean, description?: string): PropertyField => ({
	key,
	label,
	description,
	default: String(def),
	type: 'boolean'
});
const num = (
	key: string,
	label: string,
	def: number,
	min: number,
	max: number,
	description?: string
): PropertyField => ({ key, label, description, default: String(def), type: 'number', min, max });
const text = (key: string, label: string, def: string, description?: string): PropertyField => ({
	key,
	label,
	description,
	default: def,
	type: 'text'
});
const pick = (
	key: string,
	label: string,
	def: string,
	options: string[],
	description?: string
): PropertyField => ({
	key,
	label,
	description,
	default: def,
	type: 'select',
	options: options.map((value) => ({
		value,
		label: value.replace(/^minecraft:/, '').replaceAll('_', ' ')
	}))
});

export const propertyGroups: PropertyGroup[] = [
	{
		title: 'General',
		description: 'What players see and how they play.',
		fields: [
			text('motd', 'Message of the day', 'A Minecraft Server', 'Shown in the server list.'),
			num('max-players', 'Max players', 20, 0, 1_000_000),
			pick('gamemode', 'Default game mode', 'survival', [
				'survival',
				'creative',
				'adventure',
				'spectator'
			]),
			pick('difficulty', 'Difficulty', 'easy', ['peaceful', 'easy', 'normal', 'hard']),
			bool('hardcore', 'Hardcore', false, 'Players are banned from the world when they die.'),
			bool('pvp', 'Player versus player', true),
			bool('force-gamemode', 'Force game mode', false, 'Reset players to the default on join.')
		]
	},
	{
		title: 'World',
		description: 'Applies when the world is created, except where noted.',
		fields: [
			text(
				'level-name',
				'World folder',
				'world',
				'Changing it starts a new world in a new folder.'
			),
			text('level-seed', 'Seed', '', 'Empty picks a random seed.'),
			pick('level-type', 'World type', 'minecraft:normal', [
				'minecraft:normal',
				'minecraft:flat',
				'minecraft:large_biomes',
				'minecraft:amplified'
			]),
			bool('generate-structures', 'Generate structures', true),
			bool('allow-nether', 'Allow the Nether', true),
			num('spawn-protection', 'Spawn protection (blocks)', 16, 0, 29_999_984),
			num('max-world-size', 'Max world radius (blocks)', 29_999_984, 1, 29_999_984),
			num('view-distance', 'View distance (chunks)', 10, 3, 32),
			num('simulation-distance', 'Simulation distance (chunks)', 10, 3, 32)
		]
	},
	{
		title: 'Gameplay',
		description: 'Mobs, flying and commands.',
		fields: [
			bool('spawn-monsters', 'Spawn monsters', true),
			bool('spawn-animals', 'Spawn animals', true),
			bool('spawn-npcs', 'Spawn villagers', true),
			bool(
				'allow-flight',
				'Allow flight',
				false,
				'Needed by some mods; otherwise flying kicks players.'
			),
			bool('enable-command-block', 'Command blocks', false),
			num(
				'player-idle-timeout',
				'Idle kick (minutes)',
				0,
				0,
				1_000_000,
				'0 never kicks idle players.'
			),
			num('op-permission-level', 'Operator level', 4, 1, 4),
			num('entity-broadcast-range-percentage', 'Entity range (%)', 100, 10, 1000)
		]
	},
	{
		title: 'Access and network',
		description: 'Who can join and how the server talks to clients.',
		fields: [
			bool(
				'online-mode',
				'Verify players with Mojang',
				true,
				'Turn off only behind a proxy that does its own verification.'
			),
			bool('white-list', 'Whitelist', false, 'Only whitelisted players can join.'),
			bool(
				'enforce-whitelist',
				'Enforce whitelist',
				false,
				'Kick players who are removed from it.'
			),
			bool('enable-status', 'Show in the server list', true),
			bool('hide-online-players', 'Hide the player list', false),
			num(
				'network-compression-threshold',
				'Compression threshold (bytes)',
				256,
				-1,
				1_000_000,
				'-1 turns compression off.'
			),
			bool('sync-chunk-writes', 'Synchronous chunk writes', true)
		]
	}
];

/** Keys other parts of the panel set (the port, resource pack and RCON); the editor leaves them alone. */
export const MANAGED_KEYS: ReadonlySet<string> = new Set([
	'server-port',
	'resource-pack',
	'resource-pack-sha1',
	'resource-pack-id',
	'require-resource-pack',
	'resource-pack-prompt',
	'enable-rcon',
	'rcon.port',
	'rcon.password'
]);

export const propertyFields = new Map(
	propertyGroups.flatMap((g) => g.fields).map((f) => [f.key, f])
);

export const PROPERTY_KEY = /^[A-Za-z0-9._-]{1,100}$/;
export const MAX_VALUE_CHARS = 1000;

/** An error message for a value that cannot be written for this key, or null when it is fine. */
export function validateProperty(key: string, value: string): string | null {
	if (/[\r\n]/.test(value)) return 'Use a single line';
	if (value.length > MAX_VALUE_CHARS) return `At most ${MAX_VALUE_CHARS} characters`;
	const field = propertyFields.get(key);
	if (!field) return null;
	switch (field.type) {
		case 'boolean':
			return value === 'true' || value === 'false' ? null : 'Use true or false';
		case 'number': {
			if (!/^-?\d+$/.test(value)) return 'Enter a whole number';
			const n = Number(value);
			return n < field.min || n > field.max ? `Between ${field.min} and ${field.max}` : null;
		}
		case 'select':
			return field.options.some((o) => o.value === value) ? null : 'Choose one of the options';
		default:
			return null;
	}
}
