import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// Java .properties escaping: a backslash starts an escape, so a literal one is doubled
const escapeValue = (v: string) => v.replaceAll('\\', '\\\\');
const ESCAPES: Record<string, string> = { t: '\t', n: '\n', r: '\r', f: '\f' };
/** Java's reading of an escape: `\uXXXX`, a control letter, or the character itself (Minecraft writes `\:`). */
export const unescapeValue = (v: string) =>
	v.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c: string) =>
		c.length === 5 ? String.fromCharCode(parseInt(c.slice(1), 16)) : (ESCAPES[c] ?? c)
	);

/** Reads `key=value` pairs, skipping comments and blank lines. */
export function readProperties(file: string): Record<string, string> {
	if (!existsSync(file)) return {};
	const out: Record<string, string> = {};
	for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
		if (!line || line.startsWith('#')) continue;
		const eq = line.indexOf('=');
		if (eq > 0) out[line.slice(0, eq)] = unescapeValue(line.slice(eq + 1));
	}
	return out;
}

/** Merges `key=value` pairs into a .properties file, keeping every other line as it is. */
export function setProperties(file: string, values: Record<string, string | number | boolean>) {
	const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];
	const pending = new Map(Object.entries(values).map(([k, v]) => [k, escapeValue(String(v))]));
	const out = lines.map((line) => {
		const key = line.split('=')[0];
		if (pending.has(key)) {
			const value = pending.get(key);
			pending.delete(key);
			return `${key}=${value}`;
		}
		return line;
	});
	while (out.at(-1) === '') out.pop();
	for (const [k, v] of pending) out.push(`${k}=${v}`);
	writeFileSync(file, out.join('\n') + '\n');
}
