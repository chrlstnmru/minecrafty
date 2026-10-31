# Minecrafty

Self-hosted panel for running Minecraft servers. What it does, feature by feature: [docs/SPEC.md](docs/SPEC.md). Domain words (instance, runner, pack, origin, busy…): [CONTEXT.md](CONTEXT.md). Use them in code, UI text and commits.

## Read when needed

- Before running, testing or linting: [.claude/docs/commands.md](.claude/docs/commands.md).
- Before adding, moving or looking for server code, or adding a route: [.claude/docs/architecture.md](.claude/docs/architecture.md) (layout, and which module owns each concern).

## Conventions

- Remote functions (`query`, `query.live`, `form`, `command`), not form actions or endpoints. Every remote export starts with a guard from `server/auth.ts`.
- Reach a running server only through `server/live-server.ts`, never `runner-client.ts`.
- Anything that writes to a server folder calls `assertWritable` first.
- Decide an instance's origin with `instance-origin.ts`, never by reading `packProjectId` / `fromPackId`.
- UI: shadcn-svelte components first (`bunx shadcn-svelte@latest add <name> -y -o`). Forms use the kit in `src/lib/components/form/`.
- Text shown to users is plain, specific English: say what happened and what to do.
- Tests sit next to the code (`*.test.ts`). Each test file gets its own data folder (`vitest.setup.ts`). Make instances with `makeInstance` from `#test/instance.js`. Stand in for the runner with `#test/fake-runner.js` and for RCON with `#test/fake-rcon.js`. Tests must not touch the internet.

## Git

- Conventional Commits, one short line, no body: `fix: keep the sidebar open across reloads`.
- One change per issue, branch (from `main`) and PR; the PR says `Closes #N`. PRs are squash-merged.

## Comments

Write a comment only for a non-obvious why: business rules, workarounds for an API or the game, edge cases in keeping state in sync. Everything else stays uncommented.

- JSDoc (`/** … */`) on exports whose behaviour needs explaining; it may run several lines. A file may open with a short header comment saying what the file owns.
- Other comments sit next to code and are one line. No narrative paragraphs in `<script>` or in markup.
- No decorative dividers (`// ---`, `<!-- === HTML === -->`).
- Do not comment Svelte basics: runes (`$state`, `$derived`, `$effect`, `$props()`), lifecycle (`onMount`), `load` in `+page.ts`, or top-level `await`.
- Do not comment the client-server boundary: that a `.remote.ts` function runs on the server or becomes a `fetch`.
- Do not comment refreshes and cache updates (`.refresh()`, `.updates()`, `.withOverride()`).
- In `.remote.ts` files, comment only server-side constraints (Valibot validation, permission gates, side effects on the database) or a non-obvious why.
