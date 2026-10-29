<script lang="ts">
	import { createVirtualizer } from '@tanstack/svelte-virtual';
	import { tick, untrack } from 'svelte';
	import { page } from '$app/state';
	import DownloadIcon from '@tabler/icons-svelte/icons/download';
	import ArrowDownIcon from '@tabler/icons-svelte/icons/arrow-down';
	import RefreshIcon from '@tabler/icons-svelte/icons/refresh';
	import SearchIcon from '@tabler/icons-svelte/icons/search';
	import { TAIL_LINES } from '#lib/log-files.js';
	import type { LogLine } from '#lib/server/logs.js';
	import { followLog, listLogs, readLog, searchLog } from '#lib/logs.remote.js';
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
	const MAX_LIVE_LINES = 20_000;
	const tail = $derived(name && !searching ? readLog({ id, name, lines: limit }) : null);
	const found = $derived(
		name && searching ? searchLog({ id, name, query: debounced, matchCase }) : null
	);
	const view = $derived(searching ? found : tail);
	const ROW = 20;

	let follow = $state(true);
	const canFollow = $derived(name === 'latest.log' && !searching);
	const live = $derived(follow && canFollow ? followLog(id) : null);

	let appended = $state<LogLine[]>([]);
	const matches = $derived(found?.current?.matches ?? 0);
	const total = $derived((tail?.current?.total ?? 0) + appended.length);
	const rows = $derived(
		searching ? (found?.current?.lines ?? []) : [...(tail?.current?.lines ?? []), ...appended]
	);
	const hidden = $derived(Math.max(0, total - rows.length));
	const widest = $derived(rows.reduce((max, row) => Math.max(max, row.text.length), 0));

	let epoch: number | null = null;

	$effect(() => {
		void tail?.current;
		appended = [];
	});

	$effect(() => {
		if (!live) {
			epoch = null;
			return;
		}
		const frame = live.current;
		if (!frame) return;
		untrack(() => {
			if (epoch !== null && frame.epoch !== epoch) {
				epoch = frame.epoch;
				appended = [];
				void tail?.refresh();
				return;
			}
			epoch = frame.epoch;
			const known = (tail?.current?.total ?? 0) + appended.length;
			const fresh = frame.lines.filter((line) => line.n > known);
			if (fresh.length) appended = [...appended, ...fresh].slice(-MAX_LIVE_LINES);
			if (frame.total !== known + fresh.length) {
				appended = [];
				void tail?.refresh();
			}
		});
	});

	let scroller = $state<HTMLElement>();
	let pinned = $state(true);
	let stayAtTop = false;

	const virtualizer = createVirtualizer<HTMLElement, HTMLElement>({
		count: 0,
		getScrollElement: () => scroller ?? null,
		estimateSize: () => ROW,
		overscan: 30
	});

	$effect(() => {
		const count = rows.length;
		const element = scroller;
		// setOptions writes the store this effect would otherwise read, so it must not be tracked
		untrack(() => $virtualizer.setOptions({ count, getScrollElement: () => element ?? null }));
	});

	function onScroll() {
		if (scroller) pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 40;
	}

	function toBottom() {
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	}

	$effect(() => {
		if (!tail?.current && !found?.current) return;
		pinned = true;
		void tick().then(() => {
			if (!scroller) return;
			scroller.scrollTop = stayAtTop ? 0 : scroller.scrollHeight;
			stayAtTop = false;
		});
	});

	$effect(() => {
		void appended.length;
		if (pinned) void tick().then(toBottom);
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
		{#if canFollow}
			<Toggle
				variant="outline"
				bind:pressed={follow}
				aria-label="Follow the log"
				title="Follow new lines"
			>
				<span
					class="size-2 rounded-full {live?.connected ? 'bg-green-500' : 'bg-muted-foreground/50'}"
				></span>
				Live
			</Toggle>
		{/if}
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

	<div class="relative min-h-80 flex-1">
		<div
			bind:this={scroller}
			onscroll={onScroll}
			class="absolute inset-0 overflow-auto rounded-lg border bg-muted/40 py-3 font-mono text-xs leading-5"
			role="log"
			aria-live="off"
		>
			{#if files.current && !files.current.length}
				<p class="px-3 text-muted-foreground">No logs yet. They appear once the server has run.</p>
			{:else if !view?.current && !view?.error}
				<div class="grid gap-2 px-3" role="status" aria-label="Loading the log">
					{#each [60, 85, 40, 75, 55, 90, 45] as width, i (i)}
						<Skeleton class="h-3" style="width: {width}%" />
					{/each}
				</div>
			{:else if view?.error}
				<p class="px-3 text-destructive" role="alert">Could not read this log.</p>
			{:else if !rows.length}
				<p class="px-3 text-muted-foreground">
					{searching ? 'Nothing matches.' : 'This log is empty.'}
				</p>
			{/if}
			<div
				class="relative min-w-full"
				style="height: {$virtualizer.getTotalSize()}px; width: calc({widest}ch + 5rem)"
			>
				{#each $virtualizer.getVirtualItems() as item (item.key)}
					{@const row = rows[item.index]}
					{#if row}
						<div
							class="absolute top-0 left-0 flex h-5 w-full gap-3 px-3 whitespace-pre {level(
								row.text
							)}"
							style="transform: translateY({item.start}px)"
						>
							<span class="w-12 shrink-0 text-end text-muted-foreground/70 select-none"
								>{row.n}</span
							>
							<span
								>{#each parts(row.text) as part, i (i)}{#if part.hit}<mark
											class="rounded-sm bg-yellow-300/60 text-inherit dark:bg-yellow-400/30"
											>{part.text}</mark
										>{:else}{part.text}{/if}{/each}</span
							>
						</div>
					{/if}
				{/each}
			</div>
		</div>
		{#if live && !pinned}
			<Button size="sm" class="absolute right-4 bottom-4 shadow-md" onclick={toBottom}>
				<ArrowDownIcon />Jump to latest
			</Button>
		{/if}
	</div>
</div>
