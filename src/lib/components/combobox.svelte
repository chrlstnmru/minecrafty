<script lang="ts">
	import SelectorIcon from '@tabler/icons-svelte/icons/selector';
	import * as Command from '#lib/components/ui/command/index.js';
	import * as Popover from '#lib/components/ui/popover/index.js';
	import { cn } from '#lib/utils.js';

	type Option = { value: string; label: string };

	/**
	 * A select with a search box, for lists too long to scroll (Minecraft and modpack versions).
	 * Takes the same props as SelectMenu, which stays the choice for short lists.
	 */
	let {
		value = $bindable(''),
		options,
		placeholder = 'Choose…',
		searchPlaceholder = 'Search…',
		emptyText = 'Nothing found.',
		id,
		class: className,
		disabled = false,
		'aria-label': ariaLabel,
		'aria-invalid': ariaInvalid,
		onValueChange
	}: {
		value?: string;
		options: Option[];
		placeholder?: string;
		searchPlaceholder?: string;
		emptyText?: string;
		id?: string;
		class?: string;
		disabled?: boolean;
		'aria-label'?: string;
		'aria-invalid'?: boolean;
		onValueChange?: (value: string) => void;
	} = $props();

	let open = $state(false);

	// a long list opens on the chosen item, not at the top
	$effect(() => {
		if (!open) return;
		let frame = 0;
		let tries = 0;
		// the popover mounts a moment after `open` flips, so look again for a few frames
		const center = () => {
			const item = document.querySelector<HTMLElement>(
				'[data-slot=command-item][data-checked=true]'
			);
			const list = item?.closest<HTMLElement>('[data-slot=command-list]');
			if (!item || !list) {
				if (++tries < 10) frame = requestAnimationFrame(center);
				return;
			}
			// the list only: scrollIntoView would move the page behind the popover too
			const offset = item.getBoundingClientRect().top - list.getBoundingClientRect().top;
			list.scrollTop += offset - list.clientHeight / 2 + item.offsetHeight / 2;
		};
		frame = requestAnimationFrame(center);
		return () => cancelAnimationFrame(frame);
	});

	const shown = $derived(options.find((o) => o.value === value));

	function pick(next: string) {
		value = next;
		onValueChange?.(next);
		open = false;
	}
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
		<span class={cn('truncate', !shown && 'text-muted-foreground')}>
			{shown?.label ?? placeholder}
		</span>
		<SelectorIcon class="pointer-events-none size-3.5 shrink-0 text-muted-foreground" />
	</Popover.Trigger>
	<Popover.Content class="w-(--bits-popover-anchor-width) gap-0 p-0" align="start">
		<!-- start with the chosen item highlighted, so keyboard use continues from it -->
		<Command.Root value={shown?.label ?? ''}>
			<Command.Input placeholder={searchPlaceholder} />
			<Command.List>
				<Command.Empty>{emptyText}</Command.Empty>
				<Command.Group>
					{#each options as option (option.value)}
						<!-- the item draws its own check mark for data-checked -->
						<Command.Item
							value={option.label}
							data-checked={option.value === value ? 'true' : undefined}
							class="data-[checked=true]:bg-primary/10 data-[checked=true]:font-medium data-selected:data-[checked=true]:bg-primary/15"
							onSelect={() => pick(option.value)}
						>
							<span class="truncate">{option.label}</span>
						</Command.Item>
					{/each}
				</Command.Group>
			</Command.List>
		</Command.Root>
	</Popover.Content>
</Popover.Root>
