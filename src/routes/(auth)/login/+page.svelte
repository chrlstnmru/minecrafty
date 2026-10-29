<script lang="ts">
	import { login } from '#lib/auth.remote.js';
	import * as Form from '#lib/components/form/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { loginSchema } from '#lib/schemas/auth.js';

	const { username, _password } = login.fields;
</script>

<svelte:head><title>Log in · Minecrafty</title></svelte:head>

<Card.Root>
	<Card.Header>
		<Card.Title>Log in</Card.Title>
		<Card.Description>Sign in to Minecrafty</Card.Description>
	</Card.Header>
	<Card.Content>
		<Form.Root schema={loginSchema} remoteFunction={login}>
			{#snippet children({ pending })}
				<Field.Group>
					<Form.Input label="Username" field={username} autocomplete="username" />
					<Form.Input
						label="Password"
						type="password"
						field={_password}
						autocomplete="current-password"
					/>
					<Form.Errors form={login} />
					<Button type="submit" loading={pending > 0}>Log in</Button>
				</Field.Group>
			{/snippet}
		</Form.Root>
	</Card.Content>
</Card.Root>
