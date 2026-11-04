import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
	MANAGED_KEYS,
	PROPERTY_KEY,
	propertyFields,
	validateProperty
} from '../server-properties-catalog';
import { assertWritable } from './instance-jobs';
import { getInstance, serverDir } from './instances';
import { readProperties, setProperties, unescapeValue } from './server-properties';

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
	assertWritable(instanceId);
	mkdirSync(serverDir(instanceId), { recursive: true });
	setProperties(file, toWrite);
}

/** The key a line sets, or null for a comment, a blank line or a line without `=`. */
function keyOf(line: string) {
	if (line.startsWith('#') || line.startsWith('!')) return null;
	const eq = line.indexOf('=');
	return eq > 0 ? line.slice(0, eq) : null;
}

const readLines = (file: string) =>
	existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];

const withoutTrailingBlanks = (lines: string[]) => {
	const out = [...lines];
	while (out.length && !out.at(-1)!.trim()) out.pop();
	return out;
};

/**
 * The file as text, without the lines of the keys the panel manages: the RCON password must
 * never reach the browser, and the port and resource pack are changed on their own pages.
 */
export function getServerPropertiesText(instanceId: number) {
	const file = fileFor(instanceId);
	const lines = readLines(file).filter((line) => {
		const key = keyOf(line);
		return !key || !MANAGED_KEYS.has(key);
	});
	return { exists: existsSync(file), text: withoutTrailingBlanks(lines).join('\n') + '\n' };
}

/**
 * Replaces the file with this text, checking every line first and writing nothing if one is
 * wrong. The managed lines, which the text never holds, are kept from the file as they are.
 * Returns whether the file changed.
 */
export function saveServerPropertiesText(instanceId: number, text: string) {
	const file = fileFor(instanceId);
	const lines = withoutTrailingBlanks(text.split(/\r?\n/));
	const seen = new Map<string, number>();

	lines.forEach((line, i) => {
		const n = i + 1;
		if (!line.trim() || line.startsWith('#') || line.startsWith('!')) return;
		const key = keyOf(line);
		if (!key) throw new Error(`Line ${n}: write it as key=value, or start it with # for a comment`);
		if (!PROPERTY_KEY.test(key)) throw new Error(`Line ${n}: ${key} is not a valid property name`);
		if (MANAGED_KEYS.has(key))
			throw new Error(`Line ${n}: ${key} is managed by the panel. Remove the line`);
		if (seen.has(key)) throw new Error(`Line ${n}: ${key} is already set on line ${seen.get(key)}`);
		seen.set(key, n);
		const problem = validateProperty(key, unescapeValue(line.slice(key.length + 1)));
		if (problem) throw new Error(`Line ${n} (${key}): ${problem}`);
	});

	const managed = readLines(file).filter((line) => {
		const key = keyOf(line);
		return !!key && MANAGED_KEYS.has(key);
	});
	const next = [...lines, ...managed].join('\n') + '\n';
	if (existsSync(file) && readFileSync(file, 'utf8') === next) return false;
	assertWritable(instanceId);
	mkdirSync(serverDir(instanceId), { recursive: true });
	writeFileSync(file, next);
	return true;
}
