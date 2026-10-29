<script lang="ts">
	import type { RemoteForm } from '$app/server';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';

	type FormField = {
		as: (type: 'text' | 'password') => Record<string, unknown>;
		issues: () => { message: string }[] | undefined;
	};

	let {
		title,
		description,
		submit,
		action,
		fields
	}: {
		title: string;
		description: string;
		submit: string;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		action: RemoteForm<any, any>;
		fields: { name: string; label: string; type: 'text' | 'password'; field: FormField }[];
	} = $props();
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{title}</Card.Title>
		<Card.Description>{description}</Card.Description>
	</Card.Header>
	<Card.Content>
		<form {...action}>
			<Field.Group>
				{#each fields as { name, label, type, field } (name)}
					<Field.Field data-invalid={!!field.issues()?.length}>
						<Field.Label for={name}>{label}</Field.Label>
						<Input id={name} {...field.as(type)} required />
						<Field.Error errors={field.issues()} />
					</Field.Field>
				{/each}
				<Field.Error errors={action.fields.allIssues()} />
				<Button type="submit">{submit}</Button>
			</Field.Group>
		</form>
	</Card.Content>
</Card.Root>
