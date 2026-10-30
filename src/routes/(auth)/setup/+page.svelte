<script lang="ts">
	import { setup } from '#lib/auth.remote.js';
	import * as Form from '#lib/components/form/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { setupSchema } from '#lib/schemas/auth.js';

	const { username, _password, _confirm } = setup.fields;
</script>

<svelte:head><title>Setup · Minecrafty</title></svelte:head>

<Card.Root>
	<Card.Header>
		<Card.Title>Welcome to Minecrafty</Card.Title>
		<Card.Description>Create the owner account to get started</Card.Description>
	</Card.Header>
	<Card.Content>
		<Form.Root schema={setupSchema} remoteFunction={setup}>
			{#snippet children({ pending })}
				<Field.Group>
					<Form.Input label="Username" field={username} autocomplete="username" />
					<Form.Input
						label="Password"
						type="password"
						field={_password}
						autocomplete="new-password"
					/>
					<Form.Input
						label="Confirm password"
						type="password"
						field={_confirm}
						autocomplete="new-password"
					/>
					<Form.Errors form={setup} />
					<Button type="submit" loading={pending > 0}>Create owner</Button>
				</Field.Group>
			{/snippet}
		</Form.Root>
	</Card.Content>
</Card.Root>
