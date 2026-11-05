import type { KnipConfig } from 'knip';

import { compile } from 'svelte/compiler';

const TYPE_IMPORT = /^\s*import\s+type\s[^;]+;/gm;
const MIXED_IMPORT = /^\s*import\s*\{([^}]*\btype\s[^}]*)\}\s*from\s*('[^']+');/gm;

/** The compiler sees what markup uses but strips types, so type imports are put back beside its output. */
function svelteSource(source: string, filename: string) {
	const typeImports = source.match(TYPE_IMPORT) ?? [];
	const mixed = [...source.matchAll(MIXED_IMPORT)].map(([, names, from]) => {
		const types = names.split(',').filter((name) => name.trim().startsWith('type '));
		return `import { ${types.join(',')} } from ${from};`;
	});
	const { code } = compile(source, { filename, experimental: { async: true } }).js;
	return [...typeImports, ...mixed, code].join('\n');
}

export default {
	entry: ['src/params.ts'],
	project: ['src/**/*.{ts,svelte,css}', 'runner/**/*.ts'],
	ignore: ['src/lib/components/ui/**'],
	compilers: { svelte: svelteSource }
} satisfies KnipConfig;
