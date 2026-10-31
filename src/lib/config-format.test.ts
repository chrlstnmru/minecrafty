import { describe, expect, it } from 'vitest';

import { formatConfig, formatKind, lintConfig } from './config-format';

describe('formatKind', () => {
	it('names the formats a file can be tidied as, and none for the rest', () => {
		expect(formatKind('config/a.TOML')).toBe('toml');
		expect(formatKind('pack.mcmeta')).toBe('json');
		expect(formatKind('a.jsonc')).toBe('json');
		expect(formatKind('a.yml')).toBe('yaml');
		expect(formatKind('a.xml')).toBe('xml');
		expect(formatKind('README.md')).toBe('markdown');
		for (const name of ['a.json5', 'a.properties', 'a.cfg', 'a.ini', 'a.txt', 'latest.log', 'a'])
			expect(formatKind(name)).toBeNull();
	});
});

describe('JSON', () => {
	it('tidies indentation and keeps comments and a trailing comma', async () => {
		const out = await formatConfig('a.json', '{\n// keep\n"a":1,\n"b":[1,2,],\n}');
		expect(out).toContain('// keep');
		expect(out).toMatch(/^ {2}"a": 1,$/m);
		expect(out).toContain('"b": [');
	});

	it('uses tabs when the file does', async () => {
		expect(await formatConfig('a.json', '{\n\t"a":1}')).toBe('{\n\t"a": 1\n}');
	});

	it('points at the broken spot and refuses to format it', async () => {
		const text = '{"a": 1 "b": 2}';
		expect(await lintConfig('a.json', text)).toEqual([
			expect.objectContaining({ from: 8, message: 'A comma is expected here' })
		]);
		await expect(formatConfig('a.json', text)).rejects.toThrow('A comma is expected here');
	});

	it('accepts comments and a trailing comma, as Minecraft does', async () => {
		expect(await lintConfig('a.json', '// c\n{"a": [1,],}')).toEqual([]);
	});
});

describe('YAML', () => {
	it('keeps comments and never folds a long line', async () => {
		const long = 'word '.repeat(60).trim();
		const out = await formatConfig('a.yml', `# top\nroot:\n    key: ${long} # why\n`);
		expect(out).toContain('# top');
		expect(out).toContain('# why');
		expect(out).toContain(`  key: ${long}`);
	});

	it('points at the broken spot and refuses several documents', async () => {
		const problems = await lintConfig('a.yml', 'a: b: c\n');
		expect(problems).toHaveLength(1);
		expect(problems[0].message).not.toMatch(/at line/);
		await expect(formatConfig('a.yml', 'a: 1\n---\nb: 2\n')).rejects.toThrow('several YAML');
	});
});

describe('TOML', () => {
	it('keeps comments when it formats', async () => {
		const out = await formatConfig('a.toml', '# top\n[a]\nx=1 # why\ny   =  "z"\n');
		expect(out).toContain('# top');
		expect(out).toContain('# why');
		expect(out).toMatch(/x = 1/);
		expect(out).toMatch(/y = "z"/);
	});

	it('gives the line and column of a mistake and refuses to format it', async () => {
		const text = 'a = 1\nb = \n';
		const [problem] = await lintConfig('a.toml', text);
		expect(problem.from).toBeGreaterThanOrEqual(6);
		expect(problem.message).not.toContain('\n');
		await expect(formatConfig('a.toml', text)).rejects.toThrow();
		expect(await lintConfig('a.toml', 'a = 1\n')).toEqual([]);
	});
});

describe('XML', () => {
	it('indents and keeps comments', async () => {
		const out = await formatConfig('a.xml', '<a><!-- why --><b>1</b></a>');
		expect(out).toContain('<!-- why -->');
		expect(out).toMatch(/^ {2}<b>1<\/b>$/m);
	});

	it('refuses broken XML in a sentence', async () => {
		await expect(formatConfig('a.xml', '<a><b></a>')).rejects.toThrow('This is not valid XML');
	});
});

describe('Markdown', () => {
	it('tidies lists and leaves paragraph wrapping alone', async () => {
		const out = await formatConfig(
			'a.md',
			'# T\n\n* one\n* two\n\nlong line stays\nas two lines\n'
		);
		expect(out).toContain('- one');
		expect(out).toContain('long line stays\nas two lines');
	});
});

it('refuses a file type with no format', async () => {
	await expect(formatConfig('a.properties', 'a=1')).rejects.toThrow('no format');
});
