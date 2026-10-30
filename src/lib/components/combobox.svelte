<script lang="ts" generics="T extends Option">
	import { createVirtualizer } from '@tanstack/svelte-virtual';
	import CheckIcon from '@tabler/icons-svelte/icons/check';
	import SearchIcon from '@tabler/icons-svelte/icons/search';
	import SelectorIcon from '@tabler/icons-svelte/icons/selector';
	import { untrack } from 'svelte';
	import { get } from 'svelte/store';
	import * as InputGroup from '#lib/components/ui/input-group/index.js';
	import * as Popover from '#lib/components/ui/popover/index.js';
	import { cn } from '#lib/utils.js';
	import { filterOptions, moveHighlight } from './combobox-search.js';
	import type { Option, OptionSnippet, SelectionSnippet } from './option.js';

	/**
	 * A select with a search box, for lists too long to scroll (Minecraft and modpack versions).
	 * Only the rows in view are rendered, so a list of thousands opens as fast as one of ten.
	 * Takes the same props as SelectMenu, which stays the choice for short lists.
	 */
	let {
		value = $bindable(''),
		options,
		option: optionContent,
		selection,
		placeholder = 'Choose…',
		searchPlaceholder = 'Search…',
		emptyText = 'Nothing found.',
		rowHeight = 32,
		id,
		class: className,
		disabled = false,
		'aria-label': ariaLabel,
		'aria-invalid': ariaInvalid,
		onValueChange
	}: {
		value?: string;
		options: T[];
		/** how a row looks; the label by default */
		option?: OptionSnippet<T>;
		/** how the trigger shows the chosen option; the `option` content by default */
		selection?: SelectionSnippet<T>;
		placeholder?: string;
		searchPlaceholder?: string;
		emptyText?: string;
		/** px; rows are all this tall, which is what lets the list be virtual */
		rowHeight?: number;
		id?: string;
		class?: string;
		disabled?: boolean;
		'aria-label'?: string;
		'aria-invalid'?: boolean;
		onValueChange?: (value: string) => void;
	} = $props();

	const uid = $props.id();
	let open = $state(false);
	let query = $state('');
	let highlighted = $state(0);
	let scroller = $state<HTMLElement>();

	const shown = $derived(options.find((o) => o.value === value));
	const filtered = $derived(filterOptions(options, query));

	const virtualizer = createVirtualizer<HTMLElement, HTMLElement>({
		count: 0,
		getScrollElement: () => scroller ?? null,
		estimateSize: () => rowHeight,
		overscan: 8
	});

	$effect(() => {
		const count = filtered.length;
		const element = scroller;
		const size = rowHeight;
		// setOptions writes the store this effect would otherwise read, so it must not be tracked
		untrack(() =>
			$virtualizer.setOptions({
				count,
				getScrollElement: () => element ?? null,
				estimateSize: () => size
			})
		);
	});

	const reveal = (index: number, align: 'auto' | 'center') =>
		untrack(() => get(virtualizer).scrollToIndex(index, { align }));

	// each time it opens: a fresh search, the chosen option highlighted and in the middle
	$effect(() => {
		if (!open) return;
		untrack(() => {
			query = '';
			highlighted = Math.max(
				0,
				options.findIndex((o) => o.value === value)
			);
		});
	});
	$effect(() => {
		// only on opening: reading `highlighted` here would re-center the list on every hover
		if (open && scroller) untrack(() => reveal(highlighted, 'center'));
	});

	function search(next: string) {
		query = next;
		highlighted = 0;
		reveal(0, 'auto');
	}

	function pick(next: string) {
		value = next;
		onValueChange?.(next);
		open = false;
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			const chosen = filtered[highlighted];
			if (chosen) pick(chosen.value);
			return;
		}
		const next = moveHighlight(highlighted, event.key, filtered.length);
		if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		highlighted = next;
		reveal(next, 'auto');
	}

	// A scroll under a still mouse makes the browser send a pointer event for the row now beneath
	// it, which would pull the highlight away from the keys. Only a pointer that moved counts.
	let pointer = { x: -1, y: -1 };
	function hover(event: PointerEvent, index: number) {
		if (event.clientX === pointer.x && event.clientY === pointer.y) return;
		pointer = { x: event.clientX, y: event.clientY };
		highlighted = index;
	}

	const rowId = (index: number) => `${uid}-option-${index}`;
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		{id}
		{disabled}
		role="combobox"
		aria-expanded={open}
		aria-label={ariaLabel}
		aria-invalid={ariaInvalid}
		class={cn(
			'flex h-7 w-full items-center justify-between gap-1.5 rounded-md border border-input bg-input/20 px-2 py-1.5 text-xs/relaxed whitespace-nowrap transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:hover:bg-input/50',
			className
		)}
	>
		{#if shown && selection}
			{@render selection(shown)}
		{:else if shown && optionContent}
			<span class="flex min-w-0 items-center gap-2">
				{@render optionContent(shown, { selected: true })}
			</span>
		{:else}
			<span class={cn('truncate', !shown && 'text-muted-foreground')}>
				{shown?.label ?? placeholder}
			</span>
		{/if}
		<SelectorIcon class="pointer-events-none size-3.5 shrink-0 text-muted-foreground" />
	</Popover.Trigger>
	<Popover.Content class="w-(--bits-popover-anchor-width) gap-0 p-0" align="start">
		<div class="p-1 pb-0">
			<InputGroup.Root class="h-8! bg-input/20 dark:bg-input/30">
				<InputGroup.Input
					value={query}
					oninput={(e) => search(e.currentTarget.value)}
					onkeydown={onKeydown}
					placeholder={searchPlaceholder}
					autocomplete="off"
					spellcheck="false"
					role="combobox"
					aria-expanded="true"
					aria-controls="{uid}-listbox"
					aria-activedescendant={filtered.length ? rowId(highlighted) : undefined}
					class="text-xs/relaxed"
				/>
				<InputGroup.Addon>
					<SearchIcon class="size-3.5 shrink-0 opacity-50" />
				</InputGroup.Addon>
			</InputGroup.Root>
		</div>
		<div
			bind:this={scroller}
			id="{uid}-listbox"
			role="listbox"
			aria-label={ariaLabel ?? placeholder}
			class="max-h-72 scrollbar-subtle overflow-y-auto p-1 outline-none"
		>
			{#if !filtered.length}
				<p class="py-6 text-center text-xs text-muted-foreground">{emptyText}</p>
			{:else}
				<div class="relative h-(--total) w-full" style="--total: {$virtualizer.getTotalSize()}px">
					{#each $virtualizer.getVirtualItems() as item (item.key)}
						{@const row = filtered[item.index]}
						{#if row}
							{@const selected = row.value === value}
							<!-- the search box drives the list (aria-activedescendant), so rows take no keys of their own -->
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<div
								id={rowId(item.index)}
								tabindex="-1"
								role="option"
								aria-selected={selected}
								data-index={item.index}
								data-selected={selected ? 'true' : undefined}
								data-highlighted={item.index === highlighted ? 'true' : undefined}
								class={cn(
									'absolute top-0 left-0 flex h-(--row) w-full translate-y-(--start) cursor-default items-center gap-2 rounded-md px-2.5 text-xs/relaxed select-none [&_svg]:pointer-events-none [&_svg]:shrink-0',
									selected && 'bg-primary/10 font-medium',
									item.index === highlighted && (selected ? 'bg-primary/15' : 'bg-muted')
								)}
								style="--row: {rowHeight}px; --start: {item.start}px"
								onpointermove={(event) => hover(event, item.index)}
								onclick={() => pick(row.value)}
							>
								{#if optionContent}
									{@render optionContent(row, { selected })}
								{:else}
									<span class="truncate">{row.label}</span>
								{/if}
								<CheckIcon
									class={cn('ms-auto size-3.5', !selected && 'opacity-0')}
									aria-hidden="true"
								/>
							</div>
						{/if}
					{/each}
				</div>
			{/if}
		</div>
	</Popover.Content>
</Popover.Root>
