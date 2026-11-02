# Commands

```sh
bun run dev      # panel with hot reload
bun run check    # svelte-check (types)
bun run lint     # oxlint, plus eslint for .svelte
bun run format   # oxfmt
bun run test     # vitest
```

Tests run in two Vitest projects: `server` (every `*.test.ts`) and `client` (`*.svelte.test.ts`, for `.svelte.ts` modules: runes compiled for the browser so `$effect` runs, inside `$effect.root`, with `flushSync`; there is no DOM). `bun run test -- --project client` runs one.

CI runs check, lint, test and build on every PR. The pre-commit hook formats and lints staged files.
