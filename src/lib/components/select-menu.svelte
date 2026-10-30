<script lang="ts" generics="T extends Option">
	import * as Select from '#lib/components/ui/select/index.js';
	import { cn } from '#lib/utils.js';
	import type { Option, OptionSnippet, SelectionSnippet } from './option.js';

	let {
		value = $bindable(''),
		options,
		option: optionContent,
		selection,
		placeholder = 'Choose…',
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
		id?: string;
		class?: string;
		disabled?: boolean;
		'aria-label'?: string;
		'aria-invalid'?: boolean;
		onValueChange?: (value: string) => void;
	} = $props();

	/** A select item cannot have an empty value, so an empty option is carried under this one. */
	const EMPTY = '__empty__';
	const encode = (v: string) => (v === '' ? EMPTY : v);
	const shown = $derived(options.find((o) => o.value === value));
</script>

<Select.Root
	type="single"
	value={encode(value)}
	{disabled}
	onValueChange={(next) => {
		value = next === EMPTY ? '' : next;
		onValueChange?.(value);
	}}
>
	<Select.Trigger
		{id}
		class={cn('w-full', className)}
		aria-label={ariaLabel}
		aria-invalid={ariaInvalid}
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
	</Select.Trigger>
	<Select.Content>
		<Select.Group>
			{#each options as option (option.value)}
				<Select.Item value={encode(option.value)} label={option.label}>
					{#snippet children({ selected })}
						{#if optionContent}
							{@render optionContent(option, { selected })}
						{:else}
							{option.label}
						{/if}
					{/snippet}
				</Select.Item>
			{/each}
		</Select.Group>
	</Select.Content>
</Select.Root>
