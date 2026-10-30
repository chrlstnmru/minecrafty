<script lang="ts">
	let {
		value,
		relative = false,
		fallback = '—'
	}: { value: Date | string | null | undefined; relative?: boolean; fallback?: string } = $props();

	const date = $derived(value ? new Date(value) : undefined);

	const absolute = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
	const full = new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' });
	const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

	const units: [Intl.RelativeTimeFormatUnit, number][] = [
		['year', 365 * 24 * 60 * 60],
		['month', 30 * 24 * 60 * 60],
		['week', 7 * 24 * 60 * 60],
		['day', 24 * 60 * 60],
		['hour', 60 * 60],
		['minute', 60]
	];

	function fromNow(d: Date) {
		const seconds = (d.getTime() - Date.now()) / 1000;
		for (const [unit, size] of units) {
			if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
		}
		return 'Just now';
	}
</script>

{#if date}
	<time datetime={date.toISOString()} title={full.format(date)}>
		{relative ? fromNow(date) : absolute.format(date)}
	</time>
{:else}
	<span class="text-muted-foreground">{fallback}</span>
{/if}
