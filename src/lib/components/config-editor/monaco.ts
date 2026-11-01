// The slice of Monaco the config editor uses, loaded on first use and only in the browser: the
// editor, the JSON service, highlighting for the formats a config comes in, and a theme drawn
// from the app's own colours. It skips editor.main, which registers every language Monaco knows.

// the package's exports map has no path to a stylesheet, so these two are reached by file
import '../../../../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon-modifiers.css';
import '../../../../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css';
import 'monaco-editor/editor/browser/coreCommands.js';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/editor/contrib/comment/browser/comment.js';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js';
import 'monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js';
import 'monaco-editor/editor/contrib/indentation/browser/indentation.js';
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js';
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor.js';
import 'monaco-editor/editor/contrib/readOnlyMessage/browser/contribution.js';
import 'monaco-editor/editor/contrib/toggleTabFocusMode/browser/toggleTabFocusMode.js';
import 'monaco-editor/editor/contrib/unicodeHighlighter/browser/unicodeHighlighter.js';
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter.js';
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js';
import 'monaco-editor/editor/common/standaloneStrings.js';
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess.js';
import 'monaco-editor/languages/definitions/ini/register.js';
import 'monaco-editor/languages/definitions/markdown/register.js';
import 'monaco-editor/languages/definitions/xml/register.js';
import 'monaco-editor/languages/definitions/yaml/register.js';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import { jsonDefaults } from 'monaco-editor/languages/features/json/register.js';

export type Monaco = typeof monaco;
export type Editor = monaco.editor.IStandaloneCodeEditor;

const LANGUAGES: Record<string, string> = {
	json: 'json',
	jsonc: 'json',
	mcmeta: 'json',
	json5: 'json5',
	yml: 'yaml',
	yaml: 'yaml',
	toml: 'toml',
	xml: 'xml',
	md: 'markdown',
	properties: 'ini',
	cfg: 'ini',
	conf: 'ini',
	ini: 'ini'
};

/** The scheme of texts an editor keeps under a `modelKey`. */
export const MODEL_SCHEME = 'minecrafty-config';

/** Frees the texts kept under keys that start with `prefix`. */
export function disposeModels(prefix: string) {
	for (const model of monaco.editor.getModels())
		if (model.uri.scheme === MODEL_SCHEME && model.uri.path.startsWith(`/${prefix}`))
			model.dispose();
}

/** Frees the text kept for `path` under `prefix`, and for everything inside it when it is a folder. */
export function disposeModelsAt(prefix: string, path: string) {
	const at = `/${prefix}${path}`;
	for (const model of monaco.editor.getModels())
		if (
			model.uri.scheme === MODEL_SCHEME &&
			(model.uri.path === at || model.uri.path.startsWith(`${at}/`))
		)
			model.dispose();
}

export const languageFor = (name: string) =>
	LANGUAGES[name.toLowerCase().match(/\.([^./]+)$/)?.[1] ?? ''] ?? 'plaintext';

function registerToml() {
	monaco.languages.register({ id: 'toml', extensions: ['.toml'] });
	monaco.languages.setLanguageConfiguration('toml', {
		comments: { lineComment: '#' },
		brackets: [
			['[', ']'],
			['{', '}']
		],
		autoClosingPairs: [
			{ open: '[', close: ']' },
			{ open: '{', close: '}' },
			{ open: '"', close: '"', notIn: ['string'] },
			{ open: "'", close: "'", notIn: ['string'] }
		]
	});
	monaco.languages.setMonarchTokensProvider('toml', {
		tokenizer: {
			root: [
				[/#.*$/, 'comment'],
				[/^\s*\[\[[^\]]*\]\]/, 'table'],
				[/^\s*\[[^\]]*\]/, 'table'],
				[/[A-Za-z0-9_.-]+(?=\s*=)/, 'key'],
				[/"""/, 'string', '@multiBasic'],
				[/'''/, 'string', '@multiLiteral'],
				[/"/, 'string', '@basic'],
				[/'/, 'string', '@literal'],
				[/\d{4}-\d\d-\d\d(?:[Tt ]\d\d:\d\d:\d\d(?:\.\d+)?(?:[Zz]|[+-]\d\d:\d\d)?)?/, 'number'],
				[/[+-]?(?:0x[\da-fA-F_]+|0o[0-7_]+|0b[01_]+)/, 'number'],
				[/[+-]?(?:inf|nan)\b/, 'number'],
				[/[+-]?\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?/, 'number'],
				[/\b(?:true|false)\b/, 'keyword'],
				[/[=,{}[\]]/, 'delimiter']
			],
			basic: [
				[/[^"\\]+/, 'string'],
				[/\\./, 'string.escape'],
				[/"/, 'string', '@pop']
			],
			literal: [
				[/[^']+/, 'string'],
				[/'/, 'string', '@pop']
			],
			multiBasic: [
				[/[^"\\]+/, 'string'],
				[/\\./, 'string.escape'],
				[/"""/, 'string', '@pop'],
				[/"/, 'string']
			],
			multiLiteral: [
				[/[^']+/, 'string'],
				[/'''/, 'string', '@pop'],
				[/'/, 'string']
			]
		}
	});
}

// JSON5 is JSON with unquoted keys, single quotes and comments, so the JSON service would flag it
function registerJson5() {
	monaco.languages.register({ id: 'json5', extensions: ['.json5'] });
	monaco.languages.setLanguageConfiguration('json5', {
		comments: { lineComment: '//', blockComment: ['/*', '*/'] },
		brackets: [
			['{', '}'],
			['[', ']']
		],
		autoClosingPairs: [
			{ open: '{', close: '}' },
			{ open: '[', close: ']' },
			{ open: '"', close: '"', notIn: ['string'] },
			{ open: "'", close: "'", notIn: ['string'] }
		]
	});
	monaco.languages.setMonarchTokensProvider('json5', {
		tokenizer: {
			root: [
				[/\/\/.*$/, 'comment'],
				[/\/\*/, 'comment', '@comment'],
				[/[A-Za-z_$][\w$]*(?=\s*:)/, 'key'],
				[/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'key'],
				[/'(?:[^'\\]|\\.)*'(?=\s*:)/, 'key'],
				[/"(?:[^"\\]|\\.)*"/, 'string'],
				[/'(?:[^'\\]|\\.)*'/, 'string'],
				[/[+-]?(?:0[xX][\da-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|Infinity|NaN)/, 'number'],
				[/\b(?:true|false|null)\b/, 'keyword'],
				[/[{}[\],:]/, 'delimiter']
			],
			comment: [
				[/[^/*]+/, 'comment'],
				[/\*\//, 'comment', '@pop'],
				[/[/*]/, 'comment']
			]
		}
	});
}

let loaded = false;

/** Sets Monaco up once and hands it back. */
export function loadMonaco(): Monaco {
	if (loaded) return monaco;
	loaded = true;

	self.MonacoEnvironment = {
		getWorker: (_id: string, label: string) =>
			label === 'json' ? new JsonWorker() : new EditorWorker()
	};

	// Minecraft reads JSON leniently, so comments and a trailing comma are not mistakes. There is no
	// schema to complete from, and the formatting is done by config-format.ts for every language.
	jsonDefaults.setDiagnosticsOptions({
		validate: true,
		allowComments: true,
		comments: 'ignore',
		trailingCommas: 'ignore',
		schemas: [],
		enableSchemaRequest: false,
		schemaValidation: 'ignore'
	});
	jsonDefaults.setModeConfiguration({
		documentFormattingEdits: false,
		documentRangeFormattingEdits: false,
		completionItems: false,
		hovers: false,
		documentSymbols: false,
		tokens: true,
		colors: false,
		foldingRanges: true,
		diagnostics: true,
		selectionRanges: false
	});

	registerToml();
	registerJson5();
	return monaco;
}

const css = (name: string, fallback: string) =>
	getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** A theme from the app's colours, so the editor follows light and dark with the rest of the page. */
export function applyTheme(dark: boolean) {
	const [background, foreground, muted, mutedForeground, border, popover, ring] = [
		css('--background', dark ? '#0f0f11' : '#ffffff'),
		css('--foreground', dark ? '#ededf0' : '#18181b'),
		css('--muted', dark ? '#1d1d22' : '#f4f4f5'),
		css('--muted-foreground', dark ? '#8d8d97' : '#5c5c66'),
		css('--border', dark ? '#26262c' : '#e4e4e9'),
		css('--popover', dark ? '#202025' : '#ffffff'),
		css('--ring', dark ? '#4fc3e8' : '#0e8fb8')
	];
	const hex = (value: string) => value.replace('#', '');
	const rule = (token: string, color: string, fontStyle?: string) => ({
		token,
		foreground: hex(color),
		fontStyle
	});
	const name = dark ? 'minecrafty-dark' : 'minecrafty-light';

	monaco.editor.defineTheme(name, {
		base: dark ? 'vs-dark' : 'vs',
		inherit: true,
		rules: [
			rule('', foreground),
			rule('comment', mutedForeground, 'italic'),
			rule('string', css('--success', '#0b7f58')),
			rule('string.key', css('--info', '#0b7a9e')),
			rule('key', css('--info', '#0b7a9e')),
			rule('type', css('--info', '#0b7a9e')),
			rule('attribute.name', css('--info', '#0b7a9e')),
			rule('attribute.value', css('--success', '#0b7f58')),
			rule('number', css('--tint-violet', '#6d5ce8')),
			rule('keyword', css('--tint-pink', '#c2409f')),
			rule('table', css('--warning', '#92600f'), 'bold'),
			rule('tag', css('--warning', '#92600f')),
			rule('metatag', css('--warning', '#92600f')),
			rule('delimiter', mutedForeground)
		],
		colors: {
			'editor.background': background,
			'editor.foreground': foreground,
			'editorLineNumber.foreground': mutedForeground,
			'editorLineNumber.activeForeground': foreground,
			'editor.lineHighlightBackground': muted,
			'editor.lineHighlightBorder': muted,
			'editorWidget.background': popover,
			'editorWidget.border': border,
			'editorGutter.background': background,
			'editor.selectionBackground': `${ring}55`,
			'editor.inactiveSelectionBackground': `${ring}33`,
			'editorCursor.foreground': foreground,
			'editorIndentGuide.background1': border,
			'scrollbarSlider.background': `${mutedForeground}33`,
			'scrollbarSlider.hoverBackground': `${mutedForeground}55`,
			focusBorder: ring
		}
	});
	monaco.editor.setTheme(name);
}
