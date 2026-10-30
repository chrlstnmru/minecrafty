<script lang="ts">
	import * as Select from '#lib/components/ui/select/index.js';
	import { cn } from '#lib/utils.js';

	type Option = { value: string; label: string };

	let {
		value = $bindable(''),
		options,
		placeholder = 'Choose…',
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
		<span class={cn('truncate', !shown && 'text-muted-foreground')}
			>{shown?.label ?? placeholder}</span
		>
	</Select.Trigger>
	<Select.Content>
		<Select.Group>
			{#each options as option (option.value)}
				<Select.Item value={encode(option.value)} label={option.label} />
			{/each}
		</Select.Group>
	</Select.Content>
</Select.Root>
