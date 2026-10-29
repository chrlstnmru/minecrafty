<script lang="ts">
	import { setup } from '#lib/auth.remote.js';
	import AuthForm from '#lib/components/auth-form.svelte';

	const { username, _password, _confirm } = setup.fields;
</script>

<svelte:head><title>Setup · Minecrafty</title></svelte:head>

<AuthForm
	title="Welcome to Minecrafty"
	description="Create the admin account to get started"
	submit="Create admin"
	action={setup}
	fields={[
		{ name: 'username', label: 'Username', type: 'text', field: username },
		{ name: 'password', label: 'Password', type: 'password', field: _password },
		{ name: 'confirm', label: 'Confirm password', type: 'password', field: _confirm }
	]}
/>
