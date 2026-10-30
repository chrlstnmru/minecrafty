<script lang="ts">
	import { Badge } from '#lib/components/ui/badge/index.js';

	type Tone = 'success' | 'info' | 'muted' | 'danger';

	const states: Record<string, { tone: Tone; label: string }> = {
		running: { tone: 'success', label: 'Running' },
		starting: { tone: 'info', label: 'Starting' },
		stopping: { tone: 'info', label: 'Stopping' },
		installing: { tone: 'info', label: 'Installing' },
		failed: { tone: 'danger', label: 'Failed' },
		stopped: { tone: 'muted', label: 'Stopped' },
		exited: { tone: 'muted', label: 'Stopped' }
	};

	let { state }: { state: string } = $props();

	const shown = $derived(states[state] ?? { tone: 'muted' as const, label: state });
</script>

<Badge variant={shown.tone} class="h-6 gap-1.5 px-2.5 text-xs">
	<span class="size-1.5 rounded-full bg-current"></span>
	<span class="[text-box-trim:trim-start]">
		{shown.label}
	</span>
</Badge>
