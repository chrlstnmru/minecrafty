<script lang="ts">
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';

	// the part of a remote form field this needs: `form.fields.name` for a boolean field
	type CheckboxField = {
		as: (type: 'checkbox') => {
			name: string;
			checked?: boolean;
			'aria-invalid'?: boolean | 'true' | 'false';
		};
		set: (value: boolean) => unknown;
	};

	let { field, id }: { field: CheckboxField; id?: string } = $props();

	// `type="checkbox"` is for native inputs; on the shadcn checkbox (a button) it would make it submit
	const attrs = $derived.by(() => {
		const { name, checked, 'aria-invalid': invalid } = field.as('checkbox');
		return { name, checked, 'aria-invalid': invalid };
	});
</script>

<Checkbox {id} {...attrs} onCheckedChange={(checked) => field.set(checked)} />
