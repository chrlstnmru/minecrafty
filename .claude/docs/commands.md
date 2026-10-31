# Commands

```sh
bun run dev      # panel with hot reload
bun run check    # svelte-check (types)
bun run lint     # oxlint, plus eslint for .svelte
bun run format   # oxfmt
bun run test     # vitest
```

CI runs check, lint, test and build on every PR. The pre-commit hook formats and lints staged files.
