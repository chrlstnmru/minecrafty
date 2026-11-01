# Architecture

## Layout

- `src/lib/*.remote.ts`: SvelteKit remote functions, the only way pages reach the server. Every export starts with a guard (`requireUser`, `requirePermission`, `requirePanel`, `requireOwner`); `remote-guards.test.ts` enforces it.
- `src/lib/server/`: the server modules the remotes call. They take an instance id and throw plain `Error`s with text meant for the user; remotes wrap calls in `userFacing`.
- `src/lib/schemas/`: valibot schemas (a `.remote.ts` cannot export them).
- `runner/`: the detached per-instance runner and its socket protocol.
- `src/routes/`: pages, plus `+server.ts` only where a remote function cannot work (real downloads, large uploads). Those use the same guards from `auth.ts`.
- Import aliases: `#lib/*`, `#runner/*`, `#test/*`.

## Where things live

- Anything touching a running server (state, console, RCON, stop and wait, pausing saves): `server/live-server.ts`.
- Updates of server files: `runUpdate` in `server/instance-job.ts`. Background installs: `runInstall` in `server/install-progress.ts`.
- "May this instance's files change now?": `assertWritable` in `server/operations.ts`.
- File manager actions with all their rules (protected files, host code, world, busy): the action functions in `server/files.ts` (`saveFile`, `moveEntry`, `uploadFiles`…). Several at once are all-or-nothing and check each item as the single action does: `saveFiles` (by the hash each file was opened with), `removeEntries`, `moveEntries`, `describeSelection`. The page keeps one draft per opened file and the editor keeps each file's undo history by `modelKey` (`disposeModels` frees them).
- Where an instance came from: `src/lib/instance-origin.ts`.
- Modrinth dependency resolution and file picking: `server/mod-resolver.ts`.
- Showing Markdown (release notes): `components/markdown.svelte`. It draws tokens and never uses `{@html}`; keep it that way.
- Choosing a folder to move into: `components/folder-picker.svelte` is a small file manager that lists only folders, used by the Move dialogs of the pack builder and the instance file manager. The holder passes `list` (the folders inside a folder; it may be async, as the instance one is) and `exclude`; `folder-picker.ts` has the pure parts (children, exclusion, new-folder names).
- A tree of files and folders: `components/file-tree.svelte` draws it (folders open and close; each file's trailing content, such as sizes and action buttons, comes from a snippet), and `file-tree.ts` builds the nested nodes from a flat list of paths and works out where a dragged item lands (`movedPath`). Checkboxes and long-press selection are on when the holder passes `onselection` (`toggleNode`, `nodeState` and `topLevelPaths` keep a folder's choice consistent). Dragging rows to move them is on when the holder passes `onmove`, which gets the dragged paths (everything chosen when a chosen row is grabbed; `canMoveInto` says where they may land); the root is the space around the tree, so the holder takes that drop. The drag state and handlers are `drag-move.svelte.ts` (`DragMove`), shared with the instance file manager's table, which has no tree but moves rows the same way. It knows nothing about packs or instances.
- Editing text in the browser: `components/config-editor/code-editor.svelte` wraps Monaco, loaded only on first use through `config-editor/monaco.ts`; keep Monaco out of any static import. Error markers and Format for each file type: `config-format.ts` (pure, tested). What may be edited as text: `editable.ts`. A pack's config files: `readOverrideText`, `applyOverrideChanges` (every move, delete and write of one Save all, checked first and applied all or none, one revision) and `exportOverridesZip` in `server/local-packs.ts`. The Configs panel (`pack-configs.svelte`) keeps one draft per opened file and the staged moves and deletes (`pack-changes.ts`, pure: what the tree shows, and what to send), and the editor keeps each file's undo history by `modelKey`; free those with `disposeModels`.
- Audit: `record()` in `server/audit.ts`, written from the remote after the action succeeds. Background work captures `currentActor()` while the request is still there.
