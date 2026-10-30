<script lang="ts">
	import { page } from '$app/state';
	import BanIcon from '@tabler/icons-svelte/icons/ban';
	import DotsIcon from '@tabler/icons-svelte/icons/dots';
	import UsersIcon from '@tabler/icons-svelte/icons/users';
	import { toast } from 'svelte-sonner';
	import * as v from 'valibot';
	import { playerActionSchema, type PlayerAction } from '#lib/schemas/players.js';
	import { onlineNow, playerAction, playerLists, setWhitelist } from '#lib/players.remote.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';

	// the route only matches when `[id=integer]` parses, so this is always a number
	const id = $derived(page.params.id!);
	// awaited, so the server renders the lists and the browser hydrates the same markup
	const lists = $derived(await playerLists(id));
	const online = $derived(onlineNow(id));

	const message = (e: unknown, fallback: string) =>
		(e as { body?: { message?: string } }).body?.message ?? fallback;
	const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
	const isOp = (name: string) => lists.ops.some((p) => same(p.name, name));
	const isWhitelisted = (name: string) => lists.whitelist.some((p) => same(p.name, name));

	// who is on changes by the minute, so ask again while the tab is open and shown
	$effect(() => {
		const timer = setInterval(() => {
			if (document.visibilityState === 'visible') void onlineNow(id).refresh();
		}, 5000);
		return () => clearInterval(timer);
	});

	async function run(action: PlayerAction, then?: () => void) {
		// the same check the server makes, so a bad name says why instead of "Bad Request"
		const check = v.safeParse(playerActionSchema, { id, action });
		if (!check.success) return void toast.error(check.issues[0].message);
		try {
			toast.info(await playerAction({ id, action }));
			then?.();
		} catch (e) {
			toast.error(message(e, 'That did not work'));
		}
	}

	let whitelistName = $state('');
	let opName = $state('');
	let banName = $state('');
	let banReason = $state('');
	let banIp = $state('');
	let ipReason = $state('');

	let reasoning = $state<{ kind: 'kick' | 'ban'; name: string } | null>(null);
	let reasoningOpen = $state(false);
	let reason = $state('');
	const ask = (kind: 'kick' | 'ban', name: string) => {
		reasoning = { kind, name };
		reason = '';
		reasoningOpen = true;
	};
	async function confirmReason() {
		if (!reasoning) return;
		const { kind, name } = reasoning;
		reasoningOpen = false;
		await run({ type: kind, name, reason: reason.trim() || undefined });
	}

	async function toggleWhitelist(enabled: boolean) {
		try {
			await setWhitelist({ id, enabled });
			toast.success(enabled ? 'The whitelist is on' : 'The whitelist is off');
		} catch (e) {
			toast.error(message(e, 'Could not change the whitelist'));
		}
	}

	const day = (stamp: string) => stamp.split(' ')[0] ?? stamp;
</script>

{#snippet adder(
	label: string,
	value: string,
	set: (next: string) => void,
	submit: () => Promise<void>,
	placeholder: string
)}
	<form
		class="flex gap-2"
		onsubmit={async (event) => {
			event.preventDefault();
			if (value.trim()) await submit();
		}}
	>
		<Input
			{value}
			oninput={(event) => set(event.currentTarget.value)}
			{placeholder}
			aria-label={label}
			autocomplete="off"
			spellcheck="false"
			class="max-w-xs"
		/>
		<Button type="submit" size="sm" variant="outline" disabled={!value.trim()}>{label}</Button>
	</form>
{/snippet}

<Tabs.Root value="online" class="max-w-3xl">
	<Tabs.List>
		<Tabs.Trigger value="online">Online</Tabs.Trigger>
		<Tabs.Trigger value="whitelist">Whitelist</Tabs.Trigger>
		<Tabs.Trigger value="ops">Operators</Tabs.Trigger>
		<Tabs.Trigger value="bans">Banned</Tabs.Trigger>
	</Tabs.List>

	<Tabs.Content value="online">
		<Card.Root>
			<Card.Header>
				<Card.Title>Online now</Card.Title>
				<Card.Description>Players on the server, refreshed every few seconds.</Card.Description>
				{#if online.current?.state === 'online'}
					<Card.Action>
						<Badge variant="success">
							{online.current.count}{online.current.max ? ` of ${online.current.max}` : ''}
						</Badge>
					</Card.Action>
				{/if}
			</Card.Header>
			<Card.Content>
				{#if !online.current}
					<div class="grid gap-2" role="status" aria-label="Loading">
						<Skeleton class="h-8 w-full" />
						<Skeleton class="h-8 w-full" />
					</div>
				{:else if online.current.state === 'stopped'}
					<Empty.Root class="border">
						<Empty.Header>
							<Empty.Media variant="icon"><UsersIcon /></Empty.Media>
							<Empty.Title>The server is stopped</Empty.Title>
							<Empty.Description>
								Start it to see who is online. The lists on the other tabs can be changed meanwhile.
							</Empty.Description>
						</Empty.Header>
					</Empty.Root>
				{:else if online.current.state === 'unavailable'}
					<p
						class="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
						role="status"
					>
						{online.current.reason}
					</p>
				{:else if !online.current.names.length}
					<Empty.Root class="border">
						<Empty.Header>
							<Empty.Media variant="icon"><UsersIcon /></Empty.Media>
							<Empty.Title>Nobody is online</Empty.Title>
						</Empty.Header>
					</Empty.Root>
				{:else}
					{#each online.current.names as name (name)}
						<div class="flex items-center gap-3 border-b py-2 first:pt-0 last:border-b-0 last:pb-0">
							<span class="flex-1 truncate text-sm font-medium">{name}</span>
							{#if isOp(name)}<Badge variant="info">Operator</Badge>{/if}
							{#if isWhitelisted(name)}<Badge variant="muted">Whitelisted</Badge>{/if}
							<DropdownMenu.Root>
								<DropdownMenu.Trigger>
									{#snippet child({ props })}
										<Button {...props} variant="ghost" size="icon" aria-label="Actions for {name}">
											<DotsIcon />
										</Button>
									{/snippet}
								</DropdownMenu.Trigger>
								<DropdownMenu.Content align="end">
									<DropdownMenu.Item onSelect={() => ask('kick', name)}>Kick…</DropdownMenu.Item>
									<DropdownMenu.Item onSelect={() => ask('ban', name)}>Ban…</DropdownMenu.Item>
									<DropdownMenu.Separator />
									{#if isOp(name)}
										<DropdownMenu.Item onSelect={() => run({ type: 'deop', name })}>
											Remove operator
										</DropdownMenu.Item>
									{:else}
										<DropdownMenu.Item onSelect={() => run({ type: 'op', name })}>
											Make operator
										</DropdownMenu.Item>
									{/if}
									{#if isWhitelisted(name)}
										<DropdownMenu.Item onSelect={() => run({ type: 'whitelist-remove', name })}>
											Remove from whitelist
										</DropdownMenu.Item>
									{:else}
										<DropdownMenu.Item onSelect={() => run({ type: 'whitelist-add', name })}>
											Add to whitelist
										</DropdownMenu.Item>
									{/if}
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						</div>
					{/each}
				{/if}
			</Card.Content>
		</Card.Root>
	</Tabs.Content>

	<Tabs.Content value="whitelist">
		<Card.Root>
			<Card.Header>
				<Card.Title>Whitelist</Card.Title>
				<Card.Description>
					{lists.whitelistEnabled
						? 'Only these players can join.'
						: 'The whitelist is off, so anyone can join. Turn it on to let only these players in.'}
				</Card.Description>
				<Card.Action>
					<Switch
						checked={lists.whitelistEnabled}
						aria-label="Whitelist"
						onCheckedChange={toggleWhitelist}
					/>
				</Card.Action>
			</Card.Header>
			<Card.Content class="grid gap-4">
				{@render adder(
					'Add',
					whitelistName,
					(next) => (whitelistName = next),
					() =>
						run({ type: 'whitelist-add', name: whitelistName.trim() }, () => (whitelistName = '')),
					'Player name'
				)}
				{#each lists.whitelist as player (player.uuid || player.name)}
					<div class="flex items-center gap-3 border-b py-2 last:border-b-0 last:pb-0">
						<div class="min-w-0 flex-1">
							<div class="truncate text-sm font-medium">{player.name}</div>
							<div class="truncate font-mono text-xs text-muted-foreground">{player.uuid}</div>
						</div>
						<Button
							variant="ghost"
							size="sm"
							onClickPromise={() => run({ type: 'whitelist-remove', name: player.name })}
						>
							Remove
						</Button>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">Nobody is whitelisted yet.</p>
				{/each}
			</Card.Content>
		</Card.Root>
	</Tabs.Content>

	<Tabs.Content value="ops">
		<Card.Root>
			<Card.Header>
				<Card.Title>Operators</Card.Title>
				<Card.Description>
					Operators can run commands in the game. New ones get the top level.
				</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-4">
				{@render adder(
					'Add',
					opName,
					(next) => (opName = next),
					() => run({ type: 'op', name: opName.trim() }, () => (opName = '')),
					'Player name'
				)}
				{#each lists.ops as player (player.uuid || player.name)}
					<div class="flex items-center gap-3 border-b py-2 last:border-b-0 last:pb-0">
						<div class="min-w-0 flex-1">
							<div class="truncate text-sm font-medium">{player.name}</div>
							<div class="truncate font-mono text-xs text-muted-foreground">{player.uuid}</div>
						</div>
						<Badge variant="muted">Level {player.level}</Badge>
						<Button
							variant="ghost"
							size="sm"
							onClickPromise={() => run({ type: 'deop', name: player.name })}
						>
							Remove
						</Button>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">There are no operators.</p>
				{/each}
			</Card.Content>
		</Card.Root>
	</Tabs.Content>

	<Tabs.Content value="bans" class="grid gap-4">
		<Card.Root>
			<Card.Header>
				<Card.Title>Banned players</Card.Title>
				<Card.Description>Banned players cannot join until they are unbanned.</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-4">
				<form
					class="flex flex-wrap gap-2"
					onsubmit={async (event) => {
						event.preventDefault();
						if (!banName.trim()) return;
						await run(
							{ type: 'ban', name: banName.trim(), reason: banReason.trim() || undefined },
							() => {
								banName = '';
								banReason = '';
							}
						);
					}}
				>
					<Input
						bind:value={banName}
						placeholder="Player name"
						aria-label="Player to ban"
						class="max-w-48"
						autocomplete="off"
						spellcheck="false"
					/>
					<Input
						bind:value={banReason}
						placeholder="Reason (optional)"
						aria-label="Reason"
						class="max-w-xs"
						autocomplete="off"
					/>
					<Button type="submit" size="sm" variant="outline" disabled={!banName.trim()}>Ban</Button>
				</form>
				{#each lists.bans as ban (ban.uuid || ban.name)}
					<div class="flex items-center gap-3 border-b py-2 last:border-b-0 last:pb-0">
						<BanIcon class="size-4 shrink-0 text-danger" />
						<div class="min-w-0 flex-1">
							<div class="truncate text-sm font-medium">{ban.name}</div>
							<div class="truncate text-xs text-muted-foreground">
								{ban.reason || 'No reason given'}{ban.created
									? ` · ${day(ban.created)}`
									: ''}{ban.source ? ` · by ${ban.source}` : ''}
							</div>
						</div>
						<Button
							variant="ghost"
							size="sm"
							onClickPromise={() => run({ type: 'pardon', name: ban.name })}
						>
							Unban
						</Button>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">Nobody is banned.</p>
				{/each}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Banned addresses</Card.Title>
				<Card.Description>Nobody can join from these IP addresses.</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-4">
				<form
					class="flex flex-wrap gap-2"
					onsubmit={async (event) => {
						event.preventDefault();
						if (!banIp.trim()) return;
						await run(
							{ type: 'ban-ip', ip: banIp.trim(), reason: ipReason.trim() || undefined },
							() => {
								banIp = '';
								ipReason = '';
							}
						);
					}}
				>
					<Input
						bind:value={banIp}
						placeholder="IP address"
						aria-label="Address to ban"
						class="max-w-48"
						autocomplete="off"
						spellcheck="false"
					/>
					<Input
						bind:value={ipReason}
						placeholder="Reason (optional)"
						aria-label="Reason"
						class="max-w-xs"
						autocomplete="off"
					/>
					<Button type="submit" size="sm" variant="outline" disabled={!banIp.trim()}>Ban</Button>
				</form>
				{#each lists.ipBans as ban (ban.ip)}
					<div class="flex items-center gap-3 border-b py-2 last:border-b-0 last:pb-0">
						<BanIcon class="size-4 shrink-0 text-danger" />
						<div class="min-w-0 flex-1">
							<div class="truncate font-mono text-sm">{ban.ip}</div>
							<div class="truncate text-xs text-muted-foreground">
								{ban.reason || 'No reason given'}{ban.created ? ` · ${day(ban.created)}` : ''}
							</div>
						</div>
						<Button
							variant="ghost"
							size="sm"
							onClickPromise={() => run({ type: 'pardon-ip', ip: ban.ip })}
						>
							Unban
						</Button>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">No address is banned.</p>
				{/each}
			</Card.Content>
		</Card.Root>
	</Tabs.Content>
</Tabs.Root>

<Dialog.Root bind:open={reasoningOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{reasoning?.kind === 'ban' ? 'Ban' : 'Kick'} {reasoning?.name}?</Dialog.Title>
			<Dialog.Description>
				{reasoning?.kind === 'ban'
					? 'They are removed now and cannot join again until unbanned.'
					: 'They are removed from the server now and can rejoin.'}
				The reason is shown to the player.
			</Dialog.Description>
		</Dialog.Header>
		<form
			class="grid gap-4"
			onsubmit={(event) => {
				event.preventDefault();
				void confirmReason();
			}}
		>
			<Input
				bind:value={reason}
				placeholder="Reason (optional)"
				aria-label="Reason"
				autocomplete="off"
			/>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (reasoningOpen = false)}
					>Cancel</Button
				>
				<Button type="submit" variant={reasoning?.kind === 'ban' ? 'destructive' : 'default'}>
					{reasoning?.kind === 'ban' ? 'Ban' : 'Kick'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
