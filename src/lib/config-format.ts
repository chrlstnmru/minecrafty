// Error markers and Format for the config files a pack holds. Pure text in, text out (no editor, no
// DOM), so it runs in the browser and under Vitest. The formatters load on the first use.

import { applyEdits, format as formatJsonText, parse as parseJson } from 'jsonc-parser';
import { parseAllDocuments } from 'yaml';

export type Problem = { from: number; to: number; message: string };
export type ConfigKind = 'json' | 'yaml' | 'toml' | 'xml' | 'markdown';

const KINDS: Record<string, ConfigKind> = {
	json: 'json',
	jsonc: 'json',
	mcmeta: 'json',
	yml: 'yaml',
	yaml: 'yaml',
	toml: 'toml',
	xml: 'xml',
	md: 'markdown'
};

/** The format a file can be tidied as, or null when it has none (INI-style files, logs, JSON5). */
export function formatKind(name: string): ConfigKind | null {
	return KINDS[name.toLowerCase().match(/\.([^./]+)$/)?.[1] ?? ''] ?? null;
}

const eolOf = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');

// jsonc-parser's codes, as sentences (its own names are identifiers)
const JSON_ERRORS: Record<number, string> = {
	1: 'Unexpected character',
	2: 'This is not a valid number',
	3: 'A property name is expected here',
	4: 'A value is expected here',
	5: 'A colon is expected here',
	6: 'A comma is expected here',
	7: 'A closing brace } is missing',
	8: 'A closing bracket ] is missing',
	9: 'Unexpected text after the end of the file',
	10: 'Unexpected comment',
	11: 'The comment is never closed',
	12: 'The text is never closed with a quote',
	13: 'The number is cut short',
	14: 'This is not a valid unicode escape',
	15: 'This is not a valid escape',
	16: 'This character is not allowed in a string'
};

function lintJson(text: string): Problem[] {
	const errors: { error: number; offset: number; length: number }[] = [];
	// Minecraft reads these with a lenient parser: comments and a trailing comma are fine
	parseJson(text, errors, { allowTrailingComma: true });
	return errors.map(({ error, offset, length }) => ({
		from: offset,
		to: offset + Math.max(length, 1),
		message: JSON_ERRORS[error] ?? 'This is not valid JSON'
	}));
}

function lintYaml(text: string): Problem[] {
	return parseAllDocuments(text).flatMap((doc) =>
		doc.errors.map((e) => ({
			from: e.pos[0],
			to: Math.max(e.pos[1], e.pos[0] + 1),
			// the library appends the line, column and a code frame
			message: e.message.replace(/\s+at line \d+, column \d+:[\s\S]*$/, '')
		}))
	);
}

async function parseToml(text: string) {
	return (await import('smol-toml')).parse(text);
}

async function lintToml(text: string): Promise<Problem[]> {
	const { TomlError } = await import('smol-toml');
	try {
		await parseToml(text);
		return [];
	} catch (e) {
		if (!(e instanceof TomlError)) throw e;
		const lines = text.split('\n');
		const from =
			lines.slice(0, e.line - 1).reduce((sum, line) => sum + line.length + 1, 0) + e.column - 1;
		return [{ from, to: from + 1, message: e.message.split('\n')[0] }];
	}
}

/** Where a config file is wrong, for the file types that can say so without a browser. */
export async function lintConfig(name: string, text: string): Promise<Problem[]> {
	switch (formatKind(name)) {
		case 'json':
			return lintJson(text);
		case 'yaml':
			return lintYaml(text);
		case 'toml':
			return lintToml(text);
		default:
			return [];
	}
}

const refuse = (problems: Problem[]) => {
	if (problems.length) throw new Error(problems[0].message);
};

async function formatToml(text: string) {
	refuse(await lintToml(text));
	// the wasm entry that works in a browser build differs from the one for Node (tests)
	const taplo = import.meta.env.SSR
		? await import('@wasm-fmt/taplo_fmt')
		: await import('@wasm-fmt/taplo_fmt/vite').then(async (m) => (await m.default(), m));
	return taplo.format(text, { crlf: text.includes('\r\n') });
}

async function formatXml(text: string) {
	const { default: formatXmlText } = await import('xml-formatter');
	try {
		return formatXmlText(text, {
			indentation: /^\t/m.test(text) ? '\t' : '  ',
			lineSeparator: eolOf(text),
			collapseContent: true,
			strictMode: true,
			throwOnFailure: true
		});
	} catch (e) {
		throw new Error(
			`This is not valid XML: ${e instanceof Error ? e.message : 'it cannot be read'}`
		);
	}
}

async function formatMarkdown(text: string) {
	const [{ format }, markdown] = await Promise.all([
		import('prettier/standalone'),
		import('prettier/plugins/markdown')
	]);
	return format(text, {
		parser: 'markdown',
		plugins: [markdown],
		proseWrap: 'preserve',
		endOfLine: 'auto'
	});
}

/** The file tidied, comments kept. Throws a sentence for a file it cannot read, or has no format for. */
export async function formatConfig(name: string, text: string): Promise<string> {
	switch (formatKind(name)) {
		case 'json': {
			refuse(lintJson(text));
			const eol = eolOf(text);
			const tabs = /^\t/m.test(text);
			return applyEdits(
				text,
				formatJsonText(text, undefined, { insertSpaces: !tabs, tabSize: 2, eol })
			);
		}
		case 'yaml': {
			refuse(lintYaml(text));
			const docs = parseAllDocuments(text);
			if (docs.length !== 1)
				throw new Error('This file holds several YAML documents, which Format leaves alone');
			// lineWidth 0: never fold a long string onto several lines
			const out = docs[0].toString({ indent: 2, lineWidth: 0 });
			return eolOf(text) === '\r\n' ? out.replace(/\r?\n/g, '\r\n') : out;
		}
		case 'toml':
			return formatToml(text);
		case 'xml':
			return formatXml(text);
		case 'markdown':
			return formatMarkdown(text);
		default:
			throw new Error('This file type has no format');
	}
}
