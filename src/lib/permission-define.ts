// How permissions are declared: each module lists its own, a registry merges them, and the
// registry is checked once at startup. The same shape sv-erp uses for its authorization.

export type PermissionScope = 'instance' | 'panel';

export interface Permission<Key extends string = string> {
	key: Key;
	label: string;
	description?: string;
	/**
	 * `'panel'` permissions only apply from a role assigned on the whole panel (creating
	 * instances, managing users); `'instance'` ones apply on the server a role is assigned to, or on
	 * every server when the role is assigned panel-wide.
	 */
	scope: PermissionScope;
	/** Other keys the holder also gets, checked against this catalogue's own keys. */
	implies?: readonly NoInfer<Key>[];
	/** Using it on a person needs more rank than that person has (see `canActOnRecord`). */
	hierarchical?: boolean;
	/** Only the owner may put it in a role. */
	ownerOnlyGrant?: boolean;
}

export type PermissionCatalogue<Key extends string> = {
	[K in Key]: Omit<Permission<Key>, 'key'>;
};

/** Defines one module's permissions, filling in each `key` from its map key. */
export function definePermissions<Key extends string>(
	catalogue: PermissionCatalogue<Key>
): Record<Key, Permission<Key>> {
	const entries = Object.entries(catalogue) as [Key, Omit<Permission<Key>, 'key'>][];
	return Object.fromEntries(
		entries.map(([key, permission]) => [key, { key, ...permission }])
	) as Record<Key, Permission<Key>>;
}

/**
 * Checks the merged registry: every `implies` target exists, an instance-scoped permission never
 * implies a panel-scoped one (that would let a per-server role reach panel-wide power), and the
 * implications have no cycle. Throws on the first problem.
 */
export function validateRegistry(registry: Record<string, Permission>): void {
	for (const permission of Object.values(registry)) {
		for (const impliedKey of permission.implies ?? []) {
			const implied = registry[impliedKey];
			if (!implied)
				throw new Error(
					`Permission "${permission.key}" implies unknown permission "${impliedKey}"`
				);
			if (permission.scope === 'instance' && implied.scope === 'panel')
				throw new Error(
					`Permission "${permission.key}" (instance) implies "${impliedKey}" (panel); a per-server permission cannot imply a panel-wide one`
				);
		}
	}

	const state = new Map<string, 'visiting' | 'done'>();
	function visit(key: string, path: readonly string[]): void {
		if (state.get(key) === 'done') return;
		if (state.get(key) === 'visiting')
			throw new Error(`Permission implication cycle: ${[...path, key].join(' -> ')}`);
		state.set(key, 'visiting');
		for (const impliedKey of registry[key]?.implies ?? []) visit(impliedKey, [...path, key]);
		state.set(key, 'done');
	}
	for (const key of Object.keys(registry)) visit(key, []);
}

/** The keys plus everything they imply, following implications all the way down. */
export function closureOf<Key extends string>(
	registry: Record<Key, Permission>,
	keys: Iterable<Key>
): Set<Key> {
	const out = new Set<Key>();
	const stack = [...keys];
	while (stack.length) {
		const key = stack.pop()!;
		if (out.has(key) || !registry[key]) continue;
		out.add(key);
		stack.push(...((registry[key].implies ?? []) as Key[]));
	}
	return out;
}
