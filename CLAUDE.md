# Minecrafty

Self-hosted panel for running Minecraft servers. What it does, feature by feature: [docs/SPEC.md](docs/SPEC.md). Domain words (instance, runner, pack, origin, busy…): [CONTEXT.md](CONTEXT.md). Use them in code, UI text and commits.

## Commands

```sh
bun run dev      # panel with hot reload
bun run check    # svelte-check (types)
bun run lint     # oxlint, plus eslint for .svelte
bun run format   # oxfmt
bun run test     # vitest
```

CI runs check, lint, test and build on every PR. The pre-commit hook formats and lints staged files.

## Layout

- `src/lib/*.remote.ts`: SvelteKit remote functions, the only way pages reach the server. Every export starts with a guard (`requireUser`, `requirePermission`, `requirePanel`, `requireOwner`); `remote-guards.test.ts` enforces it.
- `src/lib/server/`: the server modules the remotes call. They take an instance id and throw plain `Error`s with text meant for the user; remotes wrap calls in `userFacing`.
- `src/lib/schemas/`: valibot schemas (a `.remote.ts` cannot export them).
- `runner/`: the detached per-instance runner and its socket protocol.
- `src/routes/`: pages, plus `+server.ts` only where a remote function cannot work (real downloads, large uploads). Those use the same guards from `auth.ts`.
- Import aliases: `#lib/*`, `#runner/*`, `#test/*`.

## Where things live

- Anything touching a running server (state, console, RCON, stop and wait, pausing saves): `server/live-server.ts`. Do not call `runner-client.ts` directly.
- Updates of server files: `runUpdate` in `server/instance-job.ts`. Background installs: `runInstall` in `server/install-progress.ts`.
- "May this instance's files change now?": `assertWritable` in `server/operations.ts`. Every writer of a server folder calls it.
- File manager actions with all their rules (protected files, host code, world, busy): the action functions in `server/files.ts` (`saveFile`, `moveEntry`, `uploadFiles`…).
- Where an instance came from: `src/lib/instance-origin.ts`. Do not read `packProjectId` / `fromPackId` to decide.
- Modrinth dependency resolution and file picking: `server/mod-resolver.ts`.
- Audit: `record()` in `server/audit.ts`, written from the remote after the action succeeds. Background work captures `currentActor()` while the request is still there.

## Conventions

- Remote functions (`query`, `query.live`, `form`, `command`), not form actions or endpoints.
- UI: shadcn-svelte components first (`bunx shadcn-svelte@latest add <name> -y -o`). Forms use the kit in `src/lib/components/form/`.
- Comments: only for a non-obvious why. JSDoc on exports where behaviour needs explaining. No `// ---` section dividers.
- Text shown to users is plain, specific English: say what happened and what to do.
- Tests sit next to the code (`*.test.ts`). Each test file gets its own data folder (`vitest.setup.ts`). Make instances with `makeInstance` from `#test/instance.js`. Stand in for the runner with `#test/fake-runner.js` and for RCON with `#test/fake-rcon.js`. Tests must not touch the internet.

## Git

- Conventional Commits, one short line, no body: `fix: keep the sidebar open across reloads`.
- One change per issue, branch (from `main`) and PR; the PR says `Closes #N`. PRs are squash-merged.
