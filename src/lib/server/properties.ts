import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
	MANAGED_KEYS,
	PROPERTY_KEY,
	propertyFields,
	validateProperty
} from '../server-properties-catalog';
import { getInstance, serverDir } from './instances';
import { readProperties, setProperties } from './server-properties';

function fileFor(instanceId: number) {
	if (!getInstance(instanceId)) throw new Error('Instance not found');
	return join(serverDir(instanceId), 'server.properties');
}

/** The properties in the file, without the keys the panel manages itself. */
export function getServerProperties(instanceId: number) {
	const file = fileFor(instanceId);
	const values = Object.fromEntries(
		Object.entries(readProperties(file)).filter(([key]) => !MANAGED_KEYS.has(key))
	);
	return { exists: existsSync(file), values };
}

/**
 * Writes the keys whose value differs from what the server would use now: the file's value, or
 * the default for a key it does not have. Keys outside the form can only be edited, not added.
 */
export function saveServerProperties(instanceId: number, changes: Record<string, string>) {
	const file = fileFor(instanceId);
	const current = readProperties(file);
	const toWrite: Record<string, string> = {};

	for (const [key, value] of Object.entries(changes)) {
		if (!PROPERTY_KEY.test(key)) throw new Error(`${key} is not a valid property name`);
		if (MANAGED_KEYS.has(key)) throw new Error(`${key} is managed by the panel`);
		const field = propertyFields.get(key);
		if (!field && !(key in current)) throw new Error(`${key} is not a known property`);
		const problem = validateProperty(key, value);
		if (problem) throw new Error(`${key}: ${problem}`);
		if (value !== (current[key] ?? field?.default)) toWrite[key] = value;
	}

	if (!Object.keys(toWrite).length) return;
	mkdirSync(serverDir(instanceId), { recursive: true });
	setProperties(file, toWrite);
}
