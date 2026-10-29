<script lang="ts">
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import DownloadIcon from '@tabler/icons-svelte/icons/download';
	import RefreshIcon from '@tabler/icons-svelte/icons/refresh';
	import SearchIcon from '@tabler/icons-svelte/icons/search';
	import { TAIL_LINES } from '#lib/log-files.js';
	import { listLogs, readLog, searchLog } from '#lib/logs.remote.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as InputGroup from '#lib/components/ui/input-group/index.js';
	import { NativeSelect, NativeSelectOption } from '#lib/components/ui/native-select/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { Toggle } from '#lib/components/ui/toggle/index.js';

	const id = $derived(Number(page.params.id));
	const number = new Intl.NumberFormat('en');
	const size = (bytes: number) =>
		bytes < 1024 ** 2
			? `${Math.max(1, Math.round(bytes / 1024))} KB`
			: `${(bytes / 1024 ** 2).toFixed(1)} MB`;

	const files = $derived(listLogs(id));
	let chosen = $state('');
	const name = $derived(
		files.current?.some((f) => f.name === chosen) ? chosen : (files.current?.[0]?.name ?? '')
	);

	let query = $state('');
	let debounced = $state('');
	let matchCase = $state(false);
	let limit = $state(TAIL_LINES);

	$effect(() => {
		const value = query.trim();
		const timer = setTimeout(() => (debounced = value), 300);
		return () => clearTimeout(timer);
	});

	const searching = $derived(debounced.length > 0);
	const tail = $derived(name && !searching ? readLog({ id, name, lines: limit }) : null);
	const found = $derived(
		name && searching ? searchLog({ id, name, query: debounced, matchCase }) : null
	);
	const view = $derived(searching ? found : tail);
	const rows = $derived(view?.current?.lines ?? []);

	const matches = $derived(found?.current?.matches ?? 0);
	const total = $derived(tail?.current?.total ?? 0);
	const hidden = $derived(Math.max(0, total - rows.length));

	let scroller = $state<HTMLElement>();
	let stayAtTop = false;

	$effect(() => {
		if (!view?.current) return;
		void tick().then(() => {
			if (!scroller) return;
			scroller.scrollTop = stayAtTop ? 0 : scroller.scrollHeight;
			stayAtTop = false;
		});
	});

	function showMore() {
		stayAtTop = true;
		limit += TAIL_LINES;
	}

	function select(file: string) {
		chosen = file;
		limit = TAIL_LINES;
	}

	function refresh() {
		void files.refresh();
		void view?.refresh();
	}

	const level = (text: string) =>
		/\/(ERROR|FATAL)\]/.test(text)
			? 'text-destructive'
			: /\/WARN\]/.test(text)
				? 'text-amber-600 dark:text-amber-400'
				: '';

	function parts(text: string) {
		if (!searching) return [{ text, hit: false }];
		const needle = matchCase ? debounced : debounced.toLowerCase();
		const haystack = matchCase ? text : text.toLowerCase();
		const out: { text: string; hit: boolean }[] = [];
		let at = 0;
		for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, at)) {
			if (i > at) out.push({ text: text.slice(at, i), hit: false });
			out.push({ text: text.slice(i, i + needle.length), hit: true });
			at = i + needle.length;
		}
		if (at < text.length) out.push({ text: text.slice(at), hit: false });
		return out;
	}
</script>

<svelte:head><title>Logs · Minecrafty</title></svelte:head>

<div class="flex min-h-0 flex-1 flex-col gap-3">
	<div class="flex flex-wrap items-center gap-2">
		<NativeSelect
			class="w-64 max-w-full"
			aria-label="Log file"
			value={name}
			disabled={!files.current?.length}
			onchange={(e) => select(e.currentTarget.value)}
		>
			{#each files.current ?? [] as file (file.name)}
				<NativeSelectOption value={file.name}>{file.name} · {size(file.size)}</NativeSelectOption>
			{/each}
		</NativeSelect>
		<InputGroup.Root class="min-w-48 flex-1">
			<InputGroup.Addon align="inline-start"><SearchIcon /></InputGroup.Addon>
			<InputGroup.Input
				bind:value={query}
				placeholder="Search this log…"
				autocomplete="off"
				spellcheck="false"
				disabled={!name}
			/>
			<InputGroup.Addon align="inline-end">
				<Toggle size="sm" bind:pressed={matchCase} aria-label="Match case" title="Match case"
					>Aa</Toggle
				>
			</InputGroup.Addon>
		</InputGroup.Root>
		<Button variant="outline" size="icon" aria-label="Refresh" title="Refresh" onclick={refresh}>
			<RefreshIcon />
		</Button>
		<Button
			variant="outline"
			disabled={!name}
			href="/instances/{id}/files/download?path={encodeURIComponent(`logs/${name}`)}"
			download
		>
			<DownloadIcon />Download
		</Button>
	</div>

	{#if view?.current}
		<p class="text-sm text-muted-foreground">
			{#if searching}
				{#if matches > rows.length}
					First {number.format(rows.length)} of {number.format(matches)} matching lines.
				{:else}
					{number.format(matches)}
					{matches === 1 ? 'matching line' : 'matching lines'}.
				{/if}
			{:else if hidden > 0}
				Showing the last {number.format(rows.length)} of {number.format(total)} lines.
				{#if limit < 20_000}
					<Button variant="link" size="sm" class="h-auto p-0" onclick={showMore}>
						Show {number.format(TAIL_LINES)} more
					</Button>
				{/if}
			{:else}
				{number.format(total)} {total === 1 ? 'line' : 'lines'}.
			{/if}
		</p>
	{/if}

	<div
		bind:this={scroller}
		class="min-h-80 flex-1 overflow-y-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed"
		role="log"
		aria-live="off"
	>
		{#if files.current && !files.current.length}
			<p class="text-muted-foreground">No logs yet. They appear once the server has run.</p>
		{:else if !view?.current && !view?.error}
			<div class="grid gap-2" role="status" aria-label="Loading the log">
				{#each [60, 85, 40, 75, 55, 90, 45] as width, i (i)}
					<Skeleton class="h-3" style="width: {width}%" />
				{/each}
			</div>
		{:else if view?.error}
			<p class="text-destructive" role="alert">Could not read this log.</p>
		{:else if !rows.length}
			<p class="text-muted-foreground">{searching ? 'Nothing matches.' : 'This log is empty.'}</p>
		{/if}
		{#each rows as row (row.n)}
			<div class="flex gap-3">
				<span class="w-12 shrink-0 text-end text-muted-foreground/70 select-none">{row.n}</span>
				<span class="min-w-0 flex-1 break-words whitespace-pre-wrap {level(row.text)}">
					{#each parts(row.text) as part, i (i)}{#if part.hit}<mark
								class="rounded-sm bg-yellow-300/60 text-inherit dark:bg-yellow-400/30"
								>{part.text}</mark
							>{:else}{part.text}{/if}{/each}
				</span>
			</div>
		{/each}
	</div>
</div>
