<script lang="ts">
	import { page } from '$app/state';
	import ArchiveOffIcon from '@tabler/icons-svelte/icons/archive-off';
	import DownloadIcon from '@tabler/icons-svelte/icons/download';
	import HistoryIcon from '@tabler/icons-svelte/icons/history';
	import TrashIcon from '@tabler/icons-svelte/icons/trash';
	import { toast } from 'svelte-sonner';
	import {
		createBackup,
		deleteBackup,
		instanceBackups,
		restoreBackup,
		updateBackupSettings
	} from '#lib/backups.remote.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Form from '#lib/components/form/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { formatBytes } from '#lib/format.js';
	import { backupSettingsSchema } from '#lib/schemas/backups.js';

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(page.params.id!);
	// awaited, so the server renders the list and the browser hydrates the same markup
	const data = $derived(await instanceBackups(id));
	const { keep, excludes } = updateBackupSettings.fields;

	// load the stored values into the form when the instance changes or after a save
	$effect(() => {
		updateBackupSettings.fields.set({
			id,
			keep: data.settings.keep == null ? '' : String(data.settings.keep),
			excludes: data.settings.excludes
		});
	});

	const message = (e: unknown, fallback: string) =>
		(e as { body?: { message?: string } }).body?.message ?? fallback;
	const when = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });
	const kinds = {
		manual: { label: 'Manual', variant: 'muted' },
		scheduled: { label: 'Scheduled', variant: 'info' },
		'before-restore': { label: 'Before restore', variant: 'warning' },
		'before-update': { label: 'Before update', variant: 'warning' }
	} as const;
	const total = $derived(data.backups.reduce((sum, b) => sum + b.size, 0));

	async function backUp() {
		try {
			await createBackup({ id });
			toast.success('Backup created');
		} catch (e) {
			toast.error(message(e, 'Backup failed'));
		}
	}

	type Target = { kind: 'restore' | 'delete'; backup: (typeof data.backups)[number] };
	let target = $state<Target | null>(null);
	let confirmOpen = $state(false);
	const ask = (next: Target) => {
		target = next;
		confirmOpen = true;
	};

	async function confirm() {
		if (!target) return;
		const { kind, backup } = target;
		confirmOpen = false;
		try {
			if (kind === 'restore') {
				await restoreBackup({ id, backupId: backup.id });
				toast.success('Backup restored', {
					description: 'What was there before was saved as a backup first.'
				});
			} else {
				await deleteBackup({ id, backupId: backup.id });
				toast.success('Backup deleted');
			}
		} catch (e) {
			toast.error(message(e, kind === 'restore' ? 'Restore failed' : 'Delete failed'));
		}
	}
</script>

<div class="grid max-w-3xl gap-4">
	<Card.Root>
		<Card.Header>
			<Card.Title>Saved backups</Card.Title>
			<Card.Description>
				{data.backups.length}
				{data.backups.length === 1 ? 'backup' : 'backups'} · {formatBytes(total)}. A running server
				is paused from saving for the copy, so its world stays consistent.
			</Card.Description>
			<Card.Action>
				<Button size="sm" onClickPromise={backUp} disabled={!!data.busy}>Back up now</Button>
			</Card.Action>
		</Card.Header>
		<Card.Content>
			{#each data.backups as backup (backup.id)}
				<div class="flex items-center gap-3 border-b py-2 first:pt-0 last:border-b-0 last:pb-0">
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="truncate text-sm font-medium">{when.format(backup.createdAt)}</span>
							<Badge variant={kinds[backup.kind].variant}>{kinds[backup.kind].label}</Badge>
						</div>
						<p class="truncate text-xs text-muted-foreground">
							{formatBytes(backup.size)} · {backup.note ?? backup.file}
						</p>
					</div>
					<Button
						variant="ghost"
						size="icon"
						aria-label="Download {backup.file}"
						href="/instances/{id}/backups/download?backup={backup.id}"
						download={backup.file}
					>
						<DownloadIcon />
					</Button>
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<span {...props}>
									<Button
										variant="ghost"
										size="icon"
										aria-label="Restore {backup.file}"
										disabled={data.running || !!data.busy}
										onclick={() => ask({ kind: 'restore', backup })}
									>
										<HistoryIcon />
									</Button>
								</span>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content>
							{data.running ? 'Stop the server to restore' : 'Restore this backup'}
						</Tooltip.Content>
					</Tooltip.Root>
					<Button
						variant="ghost"
						size="icon"
						class="text-danger"
						aria-label="Delete {backup.file}"
						disabled={data.busy === 'restore'}
						onclick={() => ask({ kind: 'delete', backup })}
					>
						<TrashIcon />
					</Button>
				</div>
			{:else}
				<Empty.Root class="border">
					<Empty.Header>
						<Empty.Media variant="icon"><ArchiveOffIcon /></Empty.Media>
						<Empty.Title>No backups yet</Empty.Title>
						<Empty.Description>Back up now to save the server folder as a zip.</Empty.Description>
					</Empty.Header>
				</Empty.Root>
			{/each}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Retention and exclusions</Card.Title>
			<Card.Description>
				Older backups are removed once the limit is reached. Backups made just before a restore or
				an update are always kept.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<Form.Root
				schema={backupSettingsSchema}
				remoteFunction={updateBackupSettings}
				onSubmitted={(succeeded) => {
					if (succeeded) toast.success('Backup settings saved');
				}}
			>
				{#snippet children({ pending })}
					<input {...updateBackupSettings.fields.id.as('number')} type="hidden" />
					<Field.Group>
						<Form.Input
							label="Backups to keep"
							type="number"
							field={keep}
							placeholder="Keep all"
							description="Leave empty to keep every backup."
						/>
						<Form.Textarea
							label="Left out of backups"
							field={excludes}
							class="font-mono"
							rows={3}
							description="One path per line, relative to the server folder. A folder leaves out everything in it."
						/>
						<Form.Errors form={updateBackupSettings} />
						<div>
							<Button type="submit" loading={pending > 0}>Save</Button>
						</div>
					</Field.Group>
				{/snippet}
			</Form.Root>
		</Card.Content>
	</Card.Root>
</div>

<AlertDialog.Root bind:open={confirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>
				{target?.kind === 'restore' ? 'Restore this backup?' : 'Delete this backup?'}
			</AlertDialog.Title>
			<AlertDialog.Description>
				{#if target?.kind === 'restore'}
					The server folder is replaced with the backup from {target
						? when.format(target.backup.createdAt)
						: ''}. What is there now is saved as a backup first, and the logs are kept.
				{:else}
					The zip file is removed from the host. This cannot be undone.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				variant={target?.kind === 'delete' ? 'destructive' : 'default'}
				onclick={confirm}
			>
				{target?.kind === 'restore' ? 'Restore' : 'Delete'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
