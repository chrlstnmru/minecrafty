<script lang="ts">
	import { mode } from 'mode-watcher';
	import { onMount } from 'svelte';

	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { formatKind, lintConfig } from '#lib/config-format.js';
	import { cn } from '#lib/utils.js';

	import type { Editor, Monaco } from './monaco.js';

	let {
		value = $bindable(''),
		filename,
		readonly = false,
		onsave,
		onformat,
		class: className
	}: {
		value?: string;
		/** Picks the language; give the editor a new key when the file changes, so undo stays per file. */
		filename: string;
		readonly?: boolean;
		onsave?: () => void;
		onformat?: () => void;
		class?: string;
	} = $props();

	let host = $state<HTMLDivElement>();
	let touch = $state(false);
	let monaco = $state.raw<typeof import('./monaco.js')>();
	let editor = $state.raw<Editor>();

	onMount(() => {
		// Monaco does not support touch editing, so a phone gets a plain text box
		touch = matchMedia('(pointer: coarse)').matches;
		if (touch) return;

		let gone = false;
		let model: ReturnType<Monaco['editor']['createModel']> | undefined;
		void import('./monaco.js').then((mod) => {
			if (gone || !host) return;
			const m = mod.loadMonaco();
			model = m.editor.createModel(value, mod.languageFor(filename));
			const created = m.editor.create(host, {
				model,
				readOnly: readonly,
				ariaLabel: `Editing ${filename}`,
				automaticLayout: true,
				minimap: { enabled: false },
				scrollBeyondLastLine: false,
				fontSize: 13,
				tabSize: 2,
				padding: { top: 8, bottom: 8 },
				renderWhitespace: 'selection',
				quickSuggestions: false,
				suggestOnTriggerCharacters: false,
				occurrencesHighlight: 'off',
				fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
			});
			const text = model;
			text.onDidChangeContent(() => (value = text.getValue()));
			created.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => onsave?.());
			created.addAction({
				id: 'config.format',
				label: 'Format Document',
				keybindings: [m.KeyMod.Shift | m.KeyMod.Alt | m.KeyCode.KeyF],
				contextMenuGroupId: '1_modification',
				run: () => onformat?.()
			});
			monaco = mod;
			editor = created;
		});

		return () => {
			gone = true;
			editor?.dispose();
			model?.dispose();
		};
	});

	$effect(() => {
		editor?.updateOptions({ readOnly: readonly });
	});

	$effect(() => {
		if (!editor || !monaco) return;
		monaco.loadMonaco().editor.setModelLanguage(editor.getModel()!, monaco.languageFor(filename));
	});

	// The text changes from outside when Format or a reload gives the file new content
	$effect(() => {
		const text = editor?.getModel();
		if (!editor || !text || text.getValue() === value) return;
		if (readonly) return void text.setValue(value);
		editor.pushUndoStop();
		editor.executeEdits('sync', [{ range: text.getFullModelRange(), text: value }]);
		editor.pushUndoStop();
	});

	$effect(() => {
		if (!monaco) return;
		const dark = mode.current === 'dark';
		// mode-watcher sets the page's colours just after this runs
		requestAnimationFrame(() => monaco?.applyTheme(dark));
	});

	// The JSON service marks its own mistakes; YAML and TOML are checked here
	$effect(() => {
		const text = editor?.getModel();
		if (!monaco || !text) return;
		const m = monaco.loadMonaco();
		const name = filename;
		const content = value;
		const kind = formatKind(name);
		if (kind !== 'yaml' && kind !== 'toml') {
			m.editor.setModelMarkers(text, 'config', []);
			return;
		}
		let stale = false;
		const timer = setTimeout(async () => {
			const problems = await lintConfig(name, content);
			if (stale) return;
			m.editor.setModelMarkers(
				text,
				'config',
				problems.map((problem) => {
					const start = text.getPositionAt(problem.from);
					const end = text.getPositionAt(problem.to);
					return {
						severity: m.MarkerSeverity.Error,
						message: problem.message,
						startLineNumber: start.lineNumber,
						startColumn: start.column,
						endLineNumber: end.lineNumber,
						endColumn: end.column
					};
				})
			);
		}, 400);
		return () => {
			stale = true;
			clearTimeout(timer);
		};
	});
</script>

<div class={cn('overflow-hidden rounded-md border bg-background', className)}>
	{#if touch}
		<Textarea
			bind:value
			{readonly}
			wrap="off"
			spellcheck={false}
			aria-label="Editing {filename}"
			class="h-full min-h-64 overflow-auto rounded-none border-0 font-mono text-xs whitespace-pre"
		/>
	{:else}
		<div bind:this={host} class="h-full w-full"></div>
	{/if}
</div>
