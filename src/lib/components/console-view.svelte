<script lang="ts">
	import { tick } from 'svelte';
	import { toast } from 'svelte-sonner';
	import SendIcon from '@tabler/icons-svelte/icons/send';
	import { consoleStream, sendCommand } from '#lib/instances.remote.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as InputGroup from '#lib/components/ui/input-group/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import MathGreaterIcon from '@tabler/icons-svelte/icons/math-greater';

	let { id, status = $bindable('stopped') }: { id: number; status?: string } = $props();

	const MAX_LINES = 5000;
	// oxlint-disable-next-line no-control-regex
	const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

	type Row = { key: number; text: string; marker?: boolean };

	let rows = $state<Row[]>([]);
	let lastRun: number | null = null;
	let lastSeq = 0;
	let nextKey = 0;

	// live frames overlap (a skipped frame must not lose lines), so merge them by sequence number
	function merge(frame: { run: number | null; lines: { seq: number; line: string }[] }) {
		const add: Row[] = [];
		if (frame.run !== null && frame.run !== lastRun) {
			if (lastRun !== null)
				add.push({ key: nextKey++, text: '— server restarted —', marker: true });
			lastRun = frame.run;
			lastSeq = 0;
		}
		for (const { seq, line } of frame.lines) {
			if (seq <= lastSeq) continue;
			if (lastSeq > 0 && seq > lastSeq + 1)
				add.push({ key: nextKey++, text: '— some output was skipped —', marker: true });
			lastSeq = seq;
			add.push({ key: nextKey++, text: line.replace(ANSI, '') });
		}
		if (add.length) rows = [...rows, ...add].slice(-MAX_LINES);
	}

	const stream = $derived(consoleStream(id));

	$effect(() => {
		// restart the view when switching instances
		void id;
		rows = [];
		lastRun = null;
		lastSeq = 0;
	});

	$effect(() => {
		const frame = stream.current;
		if (!frame) return;
		status = frame.state;
		merge(frame);
	});

	let scroller = $state<HTMLElement>();
	let pinned = true;

	function onScroll() {
		if (!scroller) return;
		pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
	}

	$effect(() => {
		void rows.length;
		if (!pinned) return;
		tick().then(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
	});

	let input = $state('');
	let history: string[] = [];
	let cursor = -1;
	const disableConsoleInput = $derived(!stream.connected || status !== 'running');

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		const line = input.trim();
		if (!line) return;
		input = '';
		if (history[0] !== line) history.unshift(line);
		history = history.slice(0, 100);
		cursor = -1;
		pinned = true;
		try {
			await sendCommand({ id, line });
		} catch (err) {
			toast.error((err as { body?: { message?: string } }).body?.message ?? 'Command failed');
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowUp' && cursor < history.length - 1) {
			e.preventDefault();
			input = history[++cursor];
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			input = --cursor >= 0 ? history[cursor] : '';
			cursor = Math.max(cursor, -1);
		}
	}
</script>

<div class="flex min-h-0 flex-1 flex-col gap-2">
	<div
		bind:this={scroller}
		onscroll={onScroll}
		class="min-h-80 flex-1 overflow-y-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed"
		role="log"
		aria-live="off"
	>
		{#each rows as row (row.key)}
			<div class={row.marker ? 'text-muted-foreground italic' : 'break-words whitespace-pre-wrap'}>
				{row.text}
			</div>
		{:else}
			<div class="text-muted-foreground">
				{status === 'stopped' ? 'The server is not running.' : 'Waiting for output…'}
			</div>
		{/each}
	</div>
	<form onsubmit={submit} class="flex gap-2">
		<InputGroup.Root>
			<InputGroup.Addon align="inline-start">
				{#if !stream.connected}
					<Spinner />
				{:else}
					<MathGreaterIcon />
				{/if}
			</InputGroup.Addon>
			<InputGroup.Input
				bind:value={input}
				onkeydown={onKeydown}
				placeholder={status === 'running' ? 'Type a command…' : 'Start the server to send commands'}
				disabled={disableConsoleInput}
				autocomplete="off"
				spellcheck="false"
				class="font-mono"
			/>
		</InputGroup.Root>

		<Button type="submit" disabled={disableConsoleInput || !input.trim()}>
			<SendIcon />Send
		</Button>
	</form>
</div>
