<script lang="ts">
	import type { MarkedToken, Token } from 'marked';

	import { Separator } from '#lib/components/ui/separator/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { isHtmlComment, parseMarkdown, safeHref } from '#lib/markdown.js';
	import { cn } from '#lib/utils.js';

	/**
	 * Text written in GitHub-flavoured Markdown, such as a release's notes. It is drawn from tokens,
	 * never injected as HTML, so text from the internet cannot bring its own markup: raw HTML shows
	 * as text and only http(s) links are clickable.
	 */
	let { source, class: className }: { source: string; class?: string } = $props();

	const tokens = $derived(parseMarkdown(source));
</script>

{#snippet inline(list: Token[] | undefined)}
	{#each list ?? [] as token, i (i)}
		{@const t = token as MarkedToken}
		{#if t.type === 'strong'}
			<strong class="font-semibold text-foreground">{@render inline(t.tokens)}</strong>
		{:else if t.type === 'em'}
			<em>{@render inline(t.tokens)}</em>
		{:else if t.type === 'del'}
			<del>{@render inline(t.tokens)}</del>
		{:else if t.type === 'codespan'}
			<code class="rounded bg-muted px-1 py-0.5 font-mono text-xs">{t.text}</code>
		{:else if t.type === 'br'}
			<br />
		{:else if t.type === 'checkbox'}
			<input
				type="checkbox"
				checked={t.checked}
				disabled
				aria-label={t.checked ? 'Done' : 'Not done'}
				class="me-1.5 align-middle"
			/>
		{:else if t.type === 'link'}
			{@const href = safeHref(t.href)}
			{#if href}
				<a
					{href}
					target="_blank"
					rel="noreferrer"
					class="[overflow-wrap:anywhere] text-foreground underline underline-offset-4"
					>{@render inline(t.tokens)}</a
				>
			{:else}
				{@render inline(t.tokens)}
			{/if}
		{:else if t.type === 'image'}
			{t.text}
		{:else if t.type === 'text' && t.tokens}
			{@render inline(t.tokens)}
		{:else if t.type === 'text' || t.type === 'escape'}
			{t.text}
		{/if}
	{/each}
{/snippet}

{#snippet block(list: Token[])}
	{#each list as token, i (i)}
		{@const t = token as MarkedToken}
		{#if t.type === 'heading'}
			<p class="font-semibold text-foreground" role="heading" aria-level={Math.min(t.depth + 3, 6)}>
				{@render inline(t.tokens)}
			</p>
		{:else if t.type === 'paragraph'}
			<p>{@render inline(t.tokens)}</p>
		{:else if t.type === 'text'}
			<span>{@render inline([t])}</span>
		{:else if t.type === 'list'}
			{#if t.ordered}
				<ol class="list-decimal ps-5" start={t.start === '' ? undefined : t.start}>
					{#each t.items as item, n (n)}
						<li class="[&>p]:mt-1">{@render block(item.tokens)}</li>
					{/each}
				</ol>
			{:else}
				<ul class="list-disc ps-5">
					{#each t.items as item, n (n)}
						<li class="[&>p]:mt-1">{@render block(item.tokens)}</li>
					{/each}
				</ul>
			{/if}
		{:else if t.type === 'blockquote'}
			<blockquote class="grid gap-2 border-s-2 ps-3">{@render block(t.tokens)}</blockquote>
		{:else if t.type === 'code'}
			<pre class="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs"><code>{t.text}</code
				></pre>
		{:else if t.type === 'hr'}
			<Separator />
		{:else if t.type === 'table'}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						{#each t.header as cell, n (n)}
							<Table.Head>{@render inline(cell.tokens)}</Table.Head>
						{/each}
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each t.rows as row, r (r)}
						<Table.Row>
							{#each row as cell, n (n)}
								<Table.Cell>{@render inline(cell.tokens)}</Table.Cell>
							{/each}
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{:else if t.type === 'html' && !isHtmlComment(t.text)}
			<p class="whitespace-pre-wrap">{t.text.trim()}</p>
		{/if}
	{/each}
{/snippet}

<div class={cn('grid gap-2 text-sm', className)}>
	{@render block(tokens)}
</div>
