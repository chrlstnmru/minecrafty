<script lang="ts">
	import * as Field from '#lib/components/ui/field/index.js';

	// just what is needed of a remote form, so any `form(...)` instance fits
	type Props = {
		form: { fields: { allIssues(): { path?: readonly unknown[]; message: string }[] | undefined } };
	};

	let { form }: Props = $props();

	// `allIssues()` also lists every field's own issues, which the fields already show;
	// what is left, with an empty path, belongs to the form as a whole (a failed install,
	// wrong credentials, ...)
	const issues = $derived((form.fields.allIssues() ?? []).filter((issue) => !issue.path?.length));
</script>

<Field.Error errors={issues} />
