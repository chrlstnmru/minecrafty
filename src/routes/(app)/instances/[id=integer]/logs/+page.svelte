<script lang="ts">
	import { createVirtualizer } from '@tanstack/svelte-virtual';
	import { tick, untrack } from 'svelte';
	import { get } from 'svelte/store';
	import { page } from '$app/state';
	import DownloadIcon from '@tabler/icons-svelte/icons/download';
	import ArrowDownIcon from '@tabler/icons-svelte/icons/arrow-down';
	import TextWrapIcon from '@tabler/icons-svelte/icons/text-wrap';
	import FileOffIcon from '@tabler/icons-svelte/icons/file-off';
	import SearchOffIcon from '@tabler/icons-svelte/icons/search-off';
	import RefreshIcon from '@tabler/icons-svelte/icons/refresh';
	import SearchIcon from '@tabler/icons-svelte/icons/search';
	import { TAIL_LINES } from '#lib/log-files.js';
	import type { LogLine } from '#lib/server/logs.js';
	import { followLog, listLogs, readLog, searchLog } from '#lib/logs.remote.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as InputGroup from '#lib/components/ui/input-group/index.js';
	import Combobox from '#lib/components/combobox.svelte';
	import * as Empty from '#lib/components/ui/empty/index.js';
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
	let wrap = $state(false);
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

	$effect(() => {
		void wrap;
		untrack(() => get(virtualizer).measure());
	});

	$effect(() => {
		void $virtualizer.getTotalSize();
		if (pinned) toBottom();
	});

	function measure(node: HTMLElement) {
		get(virtualizer).measureElement(node);
		return () => get(virtualizer).measureElement(null);
	}

	let lastTop = 0;

	/** Only moving up leaves the bottom: layout changes (wrapping, measuring) never lower scrollTop. */
	function onScroll() {
		if (!scroller) return;
		const top = scroller.scrollTop;
		if (scroller.scrollHeight - top - scroller.clientHeight <= 40) pinned = true;
		else if (top < lastTop) pinned = false;
		lastTop = top;
	}

	function toBottom() {
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	}

	$effect(() => {
		if (!tail?.current && !found?.current) return;
		pinned = !stayAtTop;
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
				? 'text-warning'
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
		<Combobox
			class="w-64 max-w-full"
			aria-label="Log file"
			value={name}
			disabled={!files.current?.length}
			options={(files.current ?? []).map((file) => ({
				value: file.name,
				label: `${file.name} · ${size(file.size)}`
			}))}
			onValueChange={select}
		/>
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
		<Toggle
			variant="outline"
			bind:pressed={wrap}
			aria-label="Wrap long lines"
			title="Wrap long lines"
		>
			<TextWrapIcon />Wrap
		</Toggle>
		{#if canFollow}
			<Toggle
				variant="outline"
				bind:pressed={follow}
				aria-label="Follow the log"
				title="Follow new lines"
			>
				<span
					class="size-2 rounded-full {live?.connected ? 'bg-success' : 'bg-muted-foreground/50'}"
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

	<div class="relative min-h-80 w-full flex-1 font-mono text-xs">
		<div
			bind:this={scroller}
			onscroll={onScroll}
			class="absolute inset-0 overflow-auto rounded-lg border bg-muted/40 py-3 leading-5"
			role="log"
			aria-live="off"
		>
			{#if files.current && !files.current.length}
				<Empty.Root class="h-full font-sans">
					<Empty.Header>
						<Empty.Media variant="icon"><FileOffIcon /></Empty.Media>
						<Empty.Title>No logs yet</Empty.Title>
						<Empty.Description>They appear once the server has run.</Empty.Description>
					</Empty.Header>
				</Empty.Root>
			{:else if !view?.current && !view?.error}
				<div class="grid gap-2 px-3" role="status" aria-label="Loading the log">
					{#each [60, 85, 40, 75, 55, 90, 45] as width, i (i)}
						<Skeleton class="h-3" style="width: {width}%" />
					{/each}
				</div>
			{:else if view?.error}
				<p class="px-3 text-destructive" role="alert">Could not read this log.</p>
			{:else if !rows.length}
				{#if searching}
					<Empty.Root class="h-full font-sans">
						<Empty.Header>
							<Empty.Media variant="icon"><SearchOffIcon /></Empty.Media>
							<Empty.Title>Nothing matches</Empty.Title>
							<Empty.Description>No line in this log contains “{debounced}”.</Empty.Description>
						</Empty.Header>
					</Empty.Root>
				{:else}
					<Empty.Root class="h-full font-sans">
						<Empty.Header>
							<Empty.Media variant="icon"><FileOffIcon /></Empty.Media>
							<Empty.Title>This log is empty</Empty.Title>
						</Empty.Header>
					</Empty.Root>
				{/if}
			{/if}
			<div
				class="relative min-w-full"
				style="height: {$virtualizer.getTotalSize()}px;{wrap
					? ''
					: ` width: calc(${widest}ch + 4.75rem)`}"
			>
				{#each $virtualizer.getVirtualItems() as item (item.key)}
					{@const row = rows[item.index]}
					{#if row}
						<div
							class="absolute top-0 left-0 flex w-full {wrap
								? 'whitespace-pre-wrap'
								: 'h-5 whitespace-pre'} {level(row.text)}"
							style="transform: translateY({item.start}px)"
							data-index={item.index}
							{@attach wrap ? measure : undefined}
						>
							<span
								class="sticky left-0 z-10 w-16 shrink-0 border-r bg-muted pr-2 pl-3 text-end text-muted-foreground/70 select-none"
								>{row.n}</span
							>
							<span class="min-w-0 flex-1 pr-3 pl-3 {wrap ? 'break-words' : ''}"
								>{#each parts(row.text) as part, i (i)}{#if part.hit}<mark
											class="rounded-sm bg-warning/30 text-inherit">{part.text}</mark
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
