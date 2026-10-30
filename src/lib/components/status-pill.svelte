<script lang="ts">
	import { Badge } from '#lib/components/ui/badge/index.js';

	type Tone = 'mint' | 'cyan' | 'muted' | 'destructive';

	const states: Record<string, { tone: Tone; label: string }> = {
		running: { tone: 'mint', label: 'Running' },
		starting: { tone: 'cyan', label: 'Starting' },
		stopping: { tone: 'cyan', label: 'Stopping' },
		installing: { tone: 'cyan', label: 'Installing' },
		failed: { tone: 'destructive', label: 'Failed' },
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
