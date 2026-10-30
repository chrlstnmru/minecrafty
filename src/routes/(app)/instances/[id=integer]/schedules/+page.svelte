<script lang="ts">
	import { page } from '$app/state';
	import CalendarOffIcon from '@tabler/icons-svelte/icons/calendar-off';
	import PlayerPlayIcon from '@tabler/icons-svelte/icons/player-play';
	import { toast } from 'svelte-sonner';
	import * as v from 'valibot';
	import {
		cronPreview,
		deleteSchedule,
		instanceSchedules,
		runScheduleNow,
		saveSchedule,
		toggleSchedule
	} from '#lib/schedules.remote.js';
	import { scheduleSchema, type ScheduleAction } from '#lib/schemas/schedules.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import SelectMenu from '#lib/components/select-menu.svelte';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(page.params.id!);
	// awaited, so the server renders the list and the browser hydrates the same markup
	const schedule = $derived(await instanceSchedules(id));
	const tasks = $derived(schedule.tasks);

	const message = (e: unknown, fallback: string) =>
		(e as { body?: { message?: string } }).body?.message ?? fallback;
	const when = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

	const actions = [
		{ value: 'restart', label: 'Restart the server' },
		{ value: 'stop', label: 'Stop the server' },
		{ value: 'start', label: 'Start the server' },
		{ value: 'backup', label: 'Back up the server' },
		{ value: 'command', label: 'Send a console command' }
	] satisfies { value: ScheduleAction; label: string }[];
	const presets = [
		{ value: '0 4 * * *', label: 'Every day at 04:00' },
		{ value: '0 0 * * *', label: 'Every day at midnight' },
		{ value: '0 4 * * 1', label: 'Every Monday at 04:00' },
		{ value: '0 */6 * * *', label: 'Every 6 hours' },
		{ value: '0 * * * *', label: 'Every hour' },
		{ value: '*/30 * * * *', label: 'Every 30 minutes' },
		{ value: '', label: 'Custom…' }
	];
	const badge = {
		start: 'success',
		stop: 'warning',
		restart: 'info',
		backup: 'muted',
		command: 'violet'
	} as const;
	// a task's action needs its own permission (console, start and stop, backups), so only those are offered
	const offered = $derived(actions.filter((a) => schedule.actions.includes(a.value)));
	const label = (action: ScheduleAction) =>
		actions.find((a) => a.value === action)?.label ?? action;

	type Draft = {
		scheduleId?: number;
		name: string;
		cron: string;
		action: ScheduleAction;
		command: string;
		warnMinutes: string;
		enabled: boolean;
	};
	const fresh = (): Draft => ({
		name: '',
		cron: '0 4 * * *',
		action: offered[0]?.value ?? 'restart',
		command: '',
		warnMinutes: '5',
		enabled: true
	});

	let open = $state(false);
	let draft = $state<Draft>(fresh());
	let errors = $state<Record<string, string>>({});
	let saving = $state(false);
	// a field's message goes as soon as it is edited, so it never outlives the mistake
	const clear = (field: string) => {
		if (errors[field]) delete errors[field];
	};

	const preset = $derived(presets.find((p) => p.value === draft.cron.trim())?.value ?? '');
	const warns = $derived(draft.action === 'restart' || draft.action === 'stop');
	const preview = $derived(open ? cronPreview(draft.cron) : null);

	function edit(task?: (typeof tasks)[number]) {
		draft = task
			? {
					scheduleId: task.id,
					name: task.name,
					cron: task.cron,
					action: task.action,
					command: task.command ?? '',
					warnMinutes: String(task.warnMinutes),
					enabled: task.enabled
				}
			: fresh();
		errors = {};
		open = true;
	}

	async function save() {
		const payload = {
			id,
			scheduleId: draft.scheduleId,
			name: draft.name,
			cron: draft.cron,
			action: draft.action,
			command: draft.action === 'command' ? draft.command : undefined,
			warnMinutes: warns ? Number(draft.warnMinutes || 0) : 0,
			enabled: draft.enabled
		};
		const check = v.safeParse(scheduleSchema, payload);
		if (!check.success) {
			errors = {};
			for (const issue of check.issues) {
				const key = String(issue.path?.[0]?.key ?? 'form');
				errors[key] ??= issue.message;
			}
			return;
		}
		errors = {};
		saving = true;
		try {
			await saveSchedule(payload);
			open = false;
			toast.success(draft.scheduleId ? 'Task saved' : 'Task added');
		} catch (e) {
			errors = { form: message(e, 'Could not save it') };
		} finally {
			saving = false;
		}
	}

	async function toggle(taskId: number, enabled: boolean) {
		try {
			await toggleSchedule({ id, scheduleId: taskId, enabled });
		} catch (e) {
			toast.error(message(e, 'Could not change it'));
		}
	}

	async function runNow(taskId: number) {
		try {
			const outcome = await runScheduleNow({ id, scheduleId: taskId });
			(outcome.status === 'failed' ? toast.error : toast.info)(outcome.message);
		} catch (e) {
			toast.error(message(e, 'Could not run it'));
		}
	}

	let deleting = $state<{ id: number; name: string } | null>(null);
	let deleteOpen = $state(false);
	async function confirmDelete() {
		if (!deleting) return;
		const { id: taskId } = deleting;
		deleteOpen = false;
		try {
			await deleteSchedule({ id, scheduleId: taskId });
			toast.success('Task deleted');
		} catch (e) {
			toast.error(message(e, 'Could not delete it'));
		}
	}
</script>

<div class="grid max-w-3xl gap-4">
	<Card.Root>
		<Card.Header>
			<Card.Title>Scheduled tasks</Card.Title>
			<Card.Description>
				Start, stop, restart or back up this server, or send it a command, on a schedule. Times use
				the clock of the machine the panel runs on, and a task whose time passes while the panel is
				down is skipped.
			</Card.Description>
			<Card.Action>
				<Button size="sm" disabled={!offered.length} onclick={() => edit()}>New task</Button>
			</Card.Action>
		</Card.Header>
		<Card.Content>
			{#each tasks as task (task.id)}
				<div class="flex items-center gap-3 border-b py-3 first:pt-0 last:border-b-0 last:pb-0">
					<Switch
						checked={task.enabled}
						aria-label="{task.enabled ? 'Switch off' : 'Switch on'} {task.name}"
						disabled={!task.canChange}
						onCheckedChange={(on) => toggle(task.id, on)}
					/>
					<div class="min-w-0 flex-1 {task.enabled ? '' : 'text-muted-foreground'}">
						<div class="flex flex-wrap items-center gap-2">
							<span class="truncate text-sm font-medium">{task.name}</span>
							<Badge variant={badge[task.action]}>{label(task.action)}</Badge>
							{#if task.warnMinutes}
								<Badge variant="muted">{task.warnMinutes} min warning</Badge>
							{/if}
						</div>
						<p class="truncate text-xs text-muted-foreground">
							<span class="font-mono">{task.cron}</span>
							{#if task.command}· <span class="font-mono">{task.command}</span>{/if}
							{#if task.next}· next {when.format(new Date(task.next))}{/if}
						</p>
						{#if task.lastRunAt}
							<p
								class="truncate text-xs {task.lastStatus === 'failed'
									? 'text-danger'
									: 'text-muted-foreground'}"
							>
								Last run {when.format(task.lastRunAt)}: {task.lastMessage}
							</p>
						{/if}
					</div>
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="ghost"
									size="icon"
									aria-label="Run {task.name} now"
									disabled={!task.canChange}
									onClickPromise={() => runNow(task.id)}
								>
									<PlayerPlayIcon />
								</Button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content>Run it now</Tooltip.Content>
					</Tooltip.Root>
					<Button variant="ghost" size="sm" disabled={!task.canChange} onclick={() => edit(task)}>
						Edit
					</Button>
					<Button
						variant="ghost"
						size="sm"
						class="text-danger"
						disabled={!task.canChange}
						onclick={() => {
							deleting = { id: task.id, name: task.name };
							deleteOpen = true;
						}}
					>
						Delete
					</Button>
				</div>
			{:else}
				<Empty.Root class="border">
					<Empty.Header>
						<Empty.Media variant="icon"><CalendarOffIcon /></Empty.Media>
						<Empty.Title>No scheduled tasks</Empty.Title>
						<Empty.Description>A nightly restart or backup is a good first one.</Empty.Description>
					</Empty.Header>
					<Empty.Content>
						<Button size="sm" disabled={!offered.length} onclick={() => edit()}>New task</Button>
					</Empty.Content>
				</Empty.Root>
			{/each}
		</Card.Content>
	</Card.Root>
</div>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{draft.scheduleId ? 'Edit task' : 'New task'}</Dialog.Title>
			<Dialog.Description>What to do, and when.</Dialog.Description>
		</Dialog.Header>
		<form
			class="grid gap-4"
			onsubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			<Field.Group>
				<Field.Field data-invalid={!!errors.name}>
					<Field.Label for="task-name">Name</Field.Label>
					<Input
						id="task-name"
						bind:value={draft.name}
						oninput={() => clear('name')}
						placeholder="Nightly restart"
						autocomplete="off"
					/>
					{#if errors.name}<Field.Error errors={[{ message: errors.name }]} />{/if}
				</Field.Field>

				<Field.Field>
					<Field.Label for="task-action">Action</Field.Label>
					<SelectMenu id="task-action" options={offered} bind:value={draft.action} />
				</Field.Field>

				{#if draft.action === 'command'}
					<Field.Field data-invalid={!!errors.command}>
						<Field.Label for="task-command">Command</Field.Label>
						<Input
							id="task-command"
							bind:value={draft.command}
							oninput={() => clear('command')}
							placeholder="say Remember to vote!"
							class="font-mono"
							autocomplete="off"
							spellcheck="false"
						/>
						<Field.Description>
							Typed into the server console as it is, without a leading slash.
						</Field.Description>
						{#if errors.command}<Field.Error errors={[{ message: errors.command }]} />{/if}
					</Field.Field>
				{/if}

				<Field.Field>
					<Field.Label for="task-preset">When</Field.Label>
					<SelectMenu
						id="task-preset"
						options={presets}
						value={preset}
						onValueChange={(next) => {
							if (!next) return;
							draft.cron = next;
							clear('cron');
						}}
					/>
				</Field.Field>
				<Field.Field data-invalid={!!errors.cron}>
					<Field.Label for="task-cron">Cron expression</Field.Label>
					<Input
						id="task-cron"
						bind:value={draft.cron}
						oninput={() => clear('cron')}
						class="font-mono"
						placeholder="0 4 * * *"
						autocomplete="off"
						spellcheck="false"
					/>
					<Field.Description>Minute, hour, day of month, month, day of week.</Field.Description>
					{#if errors.cron}
						<Field.Error errors={[{ message: errors.cron }]} />
					{:else if preview?.current}
						{#if preview.current.error}
							<p class="text-xs text-destructive" role="alert">{preview.current.error}</p>
						{:else}
							<p class="text-xs text-muted-foreground">
								Next: {preview.current.next.map((t) => when.format(new Date(t))).join(' · ')}
								({preview.current.timezone})
							</p>
						{/if}
					{/if}
				</Field.Field>

				{#if warns}
					<Field.Field data-invalid={!!errors.warnMinutes}>
						<Field.Label for="task-warn">Warn players, minutes ahead</Field.Label>
						<Input
							id="task-warn"
							type="number"
							min="0"
							max="60"
							bind:value={draft.warnMinutes}
							oninput={() => clear('warnMinutes')}
							class="w-24"
						/>
						<Field.Description>
							A chat message that long before, and again a minute before. 0 for none.
						</Field.Description>
						{#if errors.warnMinutes}<Field.Error errors={[{ message: errors.warnMinutes }]} />{/if}
					</Field.Field>
				{/if}

				<div class="flex items-center gap-2">
					<Switch id="task-enabled" bind:checked={draft.enabled} />
					<Label for="task-enabled">Switched on</Label>
				</div>
				{#if errors.form}<p class="text-sm text-destructive" role="alert">{errors.form}</p>{/if}
			</Field.Group>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" loading={saving}>Save</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={deleteOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete "{deleting?.name}"?</AlertDialog.Title>
			<AlertDialog.Description>It will not run again.</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" onclick={confirmDelete}>Delete</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
