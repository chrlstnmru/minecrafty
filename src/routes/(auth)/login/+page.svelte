<script lang="ts">
	import { login } from '#lib/auth.remote.js';
	import AuthForm from '#lib/components/auth-form.svelte';

	const { username, _password } = login.fields;
</script>

<svelte:head><title>Log in · Minecrafty</title></svelte:head>

<AuthForm
	title="Log in"
	description="Sign in to Minecrafty"
	submit="Log in"
	action={login}
	fields={[
		{ name: 'username', label: 'Username', type: 'text', field: username },
		{ name: 'password', label: 'Password', type: 'password', field: _password }
	]}
/>
