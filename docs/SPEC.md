# Minecrafty — Spec

Self-hosted web panel for running and managing Minecraft servers (vanilla and modded) on a single host. Similar in scope to Crafty Controller.

## Goals

- Install with one script on Windows, Linux, or Proxmox (LXC).
- Create, run, and manage multiple server instances from the browser.
- Install mods and modpacks from Modrinth and CurseForge.
- Multiple users with per-instance permissions.

## Non-goals (v1)

- Multi-node / remote agents. The process layer sits behind an interface so this can be added later.
- Docker-based instances.
- Built-in TLS. Users put a reverse proxy (Caddy, Nginx, Cloudflare Tunnel) in front.
- Shader packs. Servers never run shaders, so there is nothing for the panel to manage; players install them from Modrinth. (A copy stored on the host would only help if there were a way to hand it to players, which there is not.)

## Stack

| Layer    | Choice                                                              |
| -------- | ------------------------------------------------------------------- |
| Runtime  | Bun                                                                 |
| Web      | SvelteKit (Svelte 5) with `@sveltejs/adapter-bun`, remote functions |
| UI       | shadcn-svelte (+ extras) + Tailwind 4, `dashboard-01` app shell     |
| Database | SQLite via `bun:sqlite` + Drizzle ORM                               |
| Java     | Eclipse Temurin JRE 8 / 17 / 21 / 25, downloaded on demand          |
| Tooling  | oxfmt (format), oxlint + eslint (svelte only), lefthook hooks       |

## Architecture

```
Browser ──HTTP (remote functions, live queries)──> Panel (SvelteKit on Bun)
                        │  SQLite (users, instances, schedules, backups)
                        │
                        └─local socket─> Runner (one per instance, detached)
                                            └─stdin/stdout─> java -jar server.jar
```

### Runner process

Servers must keep running when the panel restarts or updates.

- Each instance is launched through a small detached Bun script (the runner).
- The runner owns the Java process, buffers recent console output, and exposes a local socket (Unix socket on Linux, named pipe on Windows).
- On startup the panel discovers live runners (PID file + socket) and reattaches.
- Commands sent to the socket: `stdin <line>`, `stop`, `kill`, `status`, `subscribe`.
- Graceful stop sends `stop` to the server console, then kills after a timeout.

### Instance layout on disk

```
<data>/
  panel.db
  java/<vendor>-<major>/
  instances/<id>/
    server/            # server root (world, configs, mods, plugins)
    runner.pid
    runner.sock
    instance.json      # loader, MC version, Java version, RAM, JVM args
  backups/<id>/<timestamp>.zip
```

## Features

### Instances

- Create from: Vanilla, Paper, Purpur, Fabric, Quilt, Forge, NeoForge, or modpack import.
- Version picker fed by each loader's official API/metadata. The loader build is not chosen: the newest build (stable channel for Paper) is used and recorded.
- Server jar is downloaded and checksum-verified when the instance is created.
- Settings: name, RAM min/max, JVM args, Java version (auto-picked from Mojang's `javaVersion` metadata for the Minecraft version, overridable), port, auto-start on boot. Ports are auto-assigned from 25565 upward and editable.
- Actions: start, stop, restart, kill, delete.
- Live console via `query.live` (streamed over HTTP, no WebSocket) with command input and history. Each frame repeats the most recent lines and clients merge by sequence number, because live queries only keep the latest pending value.
- `server.properties` editor with form fields for common keys.
- EULA must be accepted when the instance is created.

### Resource packs

- A server has one resource pack, delivered to players by URL. Pick a Modrinth pack: its download URL and sha1 go into `server.properties` (`resource-pack`, `resource-pack-sha1`) and nothing is stored on the host. Players download it directly from Modrinth, so it works for any player however they reach the server (including tunnels such as playit.gg).
- Any compatible version can be chosen. Options: require the pack, and a prompt message. Changes apply the next time the server starts.
- Uploading your own pack is a future feature (see below).

### Instance page

Each instance has a dedicated page, `/instances/[id]`, with a shared header (name, loader and version, port, status, start/stop/kill) and a tab bar. Every module is its own nested route (`/instances/[id]/console`, `/files`, ...) so it can be linked to and loaded on its own. Modules not yet built show a "planned" placeholder.

| Module         | Purpose                                                                      | Milestone |
| -------------- | ---------------------------------------------------------------------------- | --------- |
| Console        | Live server output with command input and history                            | 1         |
| Settings       | Name, RAM, JVM args, port, auto-start, delete                                | 1         |
| Mods           | Search, install, update, remove mods; track installed mods                   | 3         |
| Resource packs | Pick a Modrinth resource pack as the server pack; require and prompt options | 3         |
| Files          | File manager and text editor, limited to the instance root                   | 4         |
| Logs           | Browse `logs/latest.log` and rotated `.gz` files with search and download    | 4         |
| Properties     | `server.properties` editor with form fields for common keys                  | 4         |
| Players        | Online players, whitelist, ops, bans, kick (RCON)                            | 4         |
| Backups        | Manual backups (scheduled ones come with Schedules), retention, restore      | 4         |
| Schedules      | Cron tasks for this instance                                                 | 4         |
| Loader         | Update the loader build or Minecraft version, with a backup first            | 4         |

Console is the live server output with command input; Logs is the history of log files on disk.

### Loaders

| Loader         | Source                     | Notes                                                                                                |
| -------------- | -------------------------- | ---------------------------------------------------------------------------------------------------- |
| Vanilla        | Mojang version manifest    |                                                                                                      |
| Paper / Purpur | PaperMC API / Purpur API   | Plugins, not mods                                                                                    |
| Fabric         | Fabric meta                | Server launcher jar downloaded directly; newest stable loader and installer                          |
| Quilt          | Quilt meta + Maven         | Run `quilt-installer install server` headless; checksum from Maven (the meta API's hashes are wrong) |
| Forge          | Forge maven + installer    | Run installer headless (`--installServer`); handle `run.sh` / `@libraries/.../args.txt` for 1.17+    |
| NeoForge       | NeoForge maven + installer | Same as Forge                                                                                        |

### Mods and modpacks

- Search Modrinth and CurseForge from the instance page, filtered by the instance's loader and MC version. Quilt also accepts Fabric mods, and Purpur also accepts Paper/Spigot/Bukkit plugins. Paper-family instances show the tab as Plugins and install into `plugins/`; vanilla has no mods tab content.
- Install, update, remove; resolve required dependencies. Any compatible version can be chosen when installing, and an installed mod can be moved to a chosen version (including older ones). Update checks use file hashes in one request and only offer stable releases.
- Track installed mods (source, project ID, file ID, hash) in the DB so updates can be checked.
- Modpack import: Modrinth modpacks first, from the "From modpack" tab of the New Instance sheet, next to "From scratch" and "From local" (a pack decides the loader and Minecraft version, so it is not a separate screen). Search Modrinth (packs Modrinth marks as unsupported on the server, such as optimisation packs and launcher bundles, are hidden unless "Show client-only modpacks" is ticked; each result's own flag is checked because the search facet lets some through), pick a version, see a summary (Minecraft version, loader and build, files to download, client-only files skipped, config files copied), then name, port, RAM and EULA.
  - The instance is created at once in an "installing" state and finishes in the background with visible progress, since a pack can be hundreds of downloads. It cannot start or be deleted while installing; an interrupted or failed install is marked failed with the reason.
  - Install: the loader's server, every file the pack lists for the server (checksum-verified, only from the hosts the `.mrpack` format allows), then `overrides/` and `server-overrides/` copied into the server folder. Mods Modrinth knows are recorded, so they appear in the Mods tab and can be updated.
  - CurseForge manifest zips and uploading an `.mrpack` file are later (see Future features).
- Modpack update: an instance created from a Modrinth modpack remembers the pack, its version and a manifest of what it installed (`modpack.json`: the SHA-1 of every pack file and config file). Its Modpack tab (shown only for such instances) lists the pack's versions and previews an update, with nothing changed, before it is applied.
  - The old and new pack are compared against what is on disk. A mod or config is updated, added or removed only if it is still exactly what the pack installed; a file the player changed is left as it is and listed afterwards (a changed config the pack also changed can be replaced on request). Mods the player added, a mod the player deleted, the world, and a disabled mod (which stays disabled, with its new version) are handled the same way. Newest release is offered by default; going back to an older version is a deliberate choice.
  - Like a loader update, it needs the server stopped, runs in the background while the instance shows as installing, can take a "before update" backup, and builds everything (a new Minecraft version or loader build when the pack asks for one, every download, the changed configs) in `server.updating` first, so a failed download leaves the server as it was. A version that switches loaders is refused.
  - The Mods tab follows the files, and the Loader tab warns that the pack decides the loader build. Instances imported before this existed have no record and cannot be updated this way.
- CurseForge files with third-party downloads disabled: list them for manual download and accept uploads.
- CurseForge API key: entered by the admin in Settings. No key ships with the project. Modrinth needs no key.
- Server-side only: skip client-only mods where metadata says so.

### Modpack builder

Build your own modpack on the panel and create instances from it.

- Entry point: the sidebar's "Mods" item (a placeholder that never had a page) is replaced by "Modpack builder" at `/modpacks`. Managing the mods of one server stays on that instance's Mods tab.
- A pack has a name, a loader and build, a Minecraft version, and a list of mods. Each mod is pinned to an exact version and file hash, and required dependencies are resolved the same way as on an instance. Mods are added with the same Modrinth search and version picker as the instance Mods tab, filtered to the pack's loader and Minecraft version. Each entry keeps Modrinth's client/server flags, so the pack can later be exported as a proper `.mrpack`.
- Optional config files (`overrides/`: configs, scripts, datapacks) are stored with the pack and copied into every instance made from it.
- Pages follow the instance page pattern: `/modpacks` lists packs (create, duplicate, delete); `/modpacks/[id]` is the editor with Mods, Configs and Settings tabs. Changing the Minecraft version first re-checks every mod and lists those with no compatible version, and only applies once that is resolved.
- Revisions: each saved change gets a revision number, and an instance remembers the revision it was created from.
- "From local" is a third tab in the New Instance sheet, after "From scratch" and "From modpack". It lists the packs from the builder; picking one shows the same summary and the same name, port, RAM and EULA form, and creates the instance with the same background install as a Modrinth modpack: the loader's server, each mod checksum-verified (from a shared download cache), then the pack's config files.
- For now "From local" only offers packs made with the builder. Importing someone else's pack file is a later step (see Custom modpack upload).

### File manager

- Browse, create, rename, delete, upload, download inside the instance's server folder only. The current folder is in the URL (`?path=`), with breadcrumbs.
- The file manager fills the whole tab: the header (back button, breadcrumbs, toolbar) stays put and only the file list scrolls, with its column headers sticky. The back button goes up one folder and is disabled at the root. While a folder loads, the list shows skeleton rows as tall as real ones.
- The list is a TanStack Table (headless; the markup is ours). Name, Size and Modified sort in either direction and folders always stay on top. Rows have checkboxes and a select-all; the toolbar then shows the count with Clear and a Delete that asks first. A selection belongs to its folder and clears when you leave it.
- Download a file as it is, or a folder as a zip streamed from disk (the panel has its own zip writer, since Windows has no `zip` tool and Linux often lacks one). Symlinks are skipped when zipping.
- Text editor for configs: `.properties`, `.json`, `.json5`, `.toml`, `.yml`/`.yaml`, `.cfg`, `.conf`, `.ini`, `.txt`, `.mcmeta`, `.xml`, `.md`, `.snbt`, `.log`; at most 2 MB, binary files refused, and closing with unsaved edits asks first.
- Uploads: an Upload button in the file manager's toolbar opens a dialog with a drop zone that takes files or a whole folder (folder structure is kept). The zone itself is only a drop target; "Choose files" and "Choose a folder" buttons open the pickers. Once files are chosen, the zone shows them as attachments with a state per file (waiting, uploading, uploaded, failed), which can be removed or added to before sending, and a Cancel button while sending. A file with the same name is replaced.
  - Files up to 8 MB go out in batches (at most 32 MB and 200 files) as one remote command each.
  - Larger files, up to 10 GB, go out in 4 MB pieces, three at a time, as remote commands against a server-side upload session (`begin`, `piece`, `progress`, `finish`, `abort`). Pieces are written at their position in a temporary file outside the instance, optionally checked by SHA-256, and moved into place on finish. A failed piece is retried (three times, backing off) and resent when it gets no answer for two minutes; a file that still fails keeps its session, so Retry sends only the missing pieces. Cancel discards the session and its temporary file. Sessions expire after an hour idle and are cleared on panel start; the disk's free space is checked up front.
  - Progress shows per file and overall, by bytes, and moves one piece at a time.
  - The adapter's request body limit is 64 MB, which a piece or a batch stays under. Only signed-in users may send large request bodies (anonymous requests over 64 KB, or of unknown length, get a 413 before anything reads them).
- Path safety on every operation: `..`, absolute paths, Windows drive paths and NUL bytes are refused, and a path is checked through symlinks, so a link pointing outside the instance cannot be listed, read, written, created in, deleted from or uploaded into. New names are one plain name, never a path; the instance folder itself cannot be renamed or deleted.
- Protected files: the files a server cannot start without (`server.jar`, `fabric-server-launch.jar`, `quilt-server-launch.jar`, `forge-*.jar`, `eula.txt`, `run.sh`, `run.bat` at the root, and the `libraries/` folder with everything in it) cannot be deleted, renamed, or replaced by an upload, a new file or a new folder, whichever route the request takes (names compare without case, trailing dots or spaces). The listing marks them locked: a lock icon, disabled Rename and Delete, and no selection checkbox. Text files among them, such as `eula.txt`, can still be edited. This guards against accidents; it is not a security boundary, since the console can do anything. Planned: warn before touching `world/`, `ops.json`, `whitelist.json` and `server.properties` while the server runs.

### Logs

- Lists `logs/latest.log` first, then rotated logs (`*.log`, `*.log.gz`, newest first), and shows the last 2,000 lines of the chosen file with line numbers; "Show 2,000 more" extends it to 20,000. WARN and ERROR lines are coloured. Rows are virtualized with TanStack Virtual, so a 20,000-line log keeps about 50 rows in the DOM. The viewer fills the page; the content inside it is as wide as the log's longest line, so long lines scroll sideways, and line numbers stay in view while scrolling. A Wrap toggle wraps long lines instead; rows are then measured, since their heights differ.
- A Live toggle (on by default for `latest.log`) follows the file: the server watches it and streams new complete lines through a live query, and the view sticks to the bottom until you scroll up, when a "Jump to latest" button appears. When the server restarts and `latest.log` is replaced, the view reloads. Refresh reloads by hand; the Console remains the place for the server's own live output.
- Search scans the whole file (rotated logs are decompressed as a stream, capped at 512 MB of text) and shows the first 500 matching lines with the match highlighted and the total count; "Aa" matches case.
- Empty results use the `Empty` component: no logs yet, an empty log, a search with no match (as do empty folders, empty mod and pack lists, and the instance list).
- Download goes through the file manager's download route. Only plain log names are accepted (never a path), and a log that is a symlink is not listed or read.

### Properties

- A form for the common `server.properties` keys in five groups (General, Performance and limits, World, Access, Gameplay, ordered so the two columns come out about equally tall): checkboxes for booleans, number fields with their range, selects for game mode, difficulty and world type, and text for the rest. Keys in the file that have no field appear under "Other properties" and can be edited but not added. A select shows a value outside its options (`level-type=minecraft:custom`) rather than losing it.
- Values come from the file, with Minecraft's defaults for keys it lacks (the file only exists after the server first runs). Saving writes just the keys that differ from what the server would use now, keeps comments, order and unknown lines, and is refused as a whole if any value is invalid (range, options, no line breaks, at most 1,000 characters), which the form also shows beside the field.
- Keys the panel sets itself (`server-port`, the resource pack keys, RCON) are hidden and refused; the port lives in Settings and the pack in Resource packs. Changes apply when the server next starts, and a running server shows a notice saying so.

### Backups

- A backup is a zip of the server folder in `backups/<instance id>/<timestamp>.zip`, outside the instance folder so deleting or restoring the server never touches it. Streamed to disk (nothing is buffered), written to a `.partial` file first and renamed when complete, and refused up front when the disk could not hold it. One backup or restore per instance at a time.
- A running server is paused first: `save-off`, then `save-all flush`, and the backup waits for the server's confirmation (it fails rather than copy an unflushed world); `save-on` is sent afterwards even when the backup fails.
- Excludes: paths relative to the server folder, one per line (default `logs` and `crash-reports`); a folder leaves out everything in it. Symlinks are never followed.
- Retention: keep the newest N manual and scheduled backups (default 5, empty keeps all); backups made just before a restore are never pruned.
- Restore needs the server stopped. It first backs up what is there ("Before restore"), unpacks the archive next to the server with every path checked and every file's size and CRC verified, and swaps it in only when that succeeded, so a damaged archive leaves the server untouched. Excluded paths (logs) are carried over from the old folder. Mods tracked in the panel may no longer match the restored files.
- Download goes through `/instances/[id]/backups/download?backup=<id>`.
- Limits: the zip writer has no Zip64, so a backup is limited to 4 GiB and 65,535 files, and a larger server fails with a clear message. Zip64 is the follow-up if that bites.
- Scheduled backups arrive with scheduled tasks.

### Loader update

- Moves an instance to the newest build of a Minecraft version, which may be the current one (a build update) or another (an upgrade or a downgrade). Only the newest build of a version is offered; the Loader tab shows the installed build and whether a newer one exists.
- The server must be stopped. The instance shows as installing while it runs in the background, with progress, and the outcome of the last update stays visible on the tab.
- The new loader files are built in `server.updating` next to the server (the installer runs there for Quilt, Forge and NeoForge) and swapped in only after the install succeeded, so a failed download or installer leaves the old server exactly as it was. The swap first removes what the old loader left that would be picked up ahead of the new files (`libraries/`, `forge-*.jar`, `run.sh`) and never overwrites `user_jvm_args.txt`.
- "Back up first" is on by default; the backup is kept as "Before update" and is never pruned.
- Upgrading warns that the world is converted when the server next starts, downgrading warns that it can be damaged, and changing version warns about the installed mods (check the Mods tab for compatible versions afterwards). A Java version chosen by hand that is too old for the new Minecraft version goes back to automatic.
- A panel restart during the swap marks the install failed, like any interrupted install.

### Scheduled tasks

- Cron expressions per instance.
- Actions: start, stop, restart, backup, send console command.
- Optional in-game warning before restart/stop.

### Live stats

- Per instance: CPU and RAM of the Java process, uptime, status.
- Players online and player list via RCON or server query (panel enables RCON with a random password on creation).
- Host overview and the per-instance numbers feed the dashboard (see Dashboard).

### Dashboard

The home page (`/`) replaces the placeholder content that came with the shadcn dashboard block. It shows how the host and the servers are doing, and lets you act on a server without opening it.

- KPI cards, system metrics first:
  - CPU: host usage now, with a short trend.
  - RAM: used and total, and how much of it the running instances account for.
  - Storage: used and free on the volume holding the data folder, and how much instances and backups take.
  - Instances: running out of total, and how many are installing or failed.
  - Players online: the total across running instances.
  - More cards worth having once the data exists: last backup (and any instance with none), host and panel uptime, scheduled tasks due soon.
- Instances table: every instance in one list, with quick actions and live statistics.
  - Quick actions per row: start, restart, stop (kill stays on the instance page). Restart is a graceful stop followed by a start, and is only offered while running.
  - Columns: name (links to the instance), status (including installing and failed), CPU and RAM of the Java process, storage used by the instance folder, players online out of the maximum, and the loader and Minecraft version.
  - Sortable and filterable by status; the numbers update live (the same live-query mechanism as the instance list).
- Sampling: CPU and RAM come from the operating system per process (the runner knows the Java PID), host figures from the OS, players from RCON or a server query. Storage is the slow one (walking a world folder), so folder sizes are computed in the background every few minutes and cached rather than on every refresh.
- Only instances the signed-in user may view appear, matching the per-instance permissions.

### Users and permissions

- First-run setup creates the admin account.
- Roles: admin (everything), user (only assigned instances).
- Per-instance permissions: view, console, start/stop, files, mods, backups, schedules, settings.
- Session auth with hashed passwords (`Bun.password`, argon2).
- Audit log of actions per instance.

## Release packaging

- Milestones 1–4: run as plain Bun (`bun build/index.js`). No compile step during development.
- Milestone 5: ship a single binary per platform via `bun build --compile` (`bun-linux-x64`, `bun-linux-arm64`, `bun-windows-x64`), built in one CI job.
- Client assets are embedded in the binary.
- The runner is the same binary started as `minecrafty runner <id>`.
- The build output must stay runnable with plain Bun as a fallback (e.g. if unsigned Windows binaries hit antivirus problems).

## Install scripts

| Script           | Target                     | Does                                                                          |
| ---------------- | -------------------------- | ----------------------------------------------------------------------------- |
| `install.sh`     | Debian/Ubuntu, Proxmox LXC | Download panel binary, create user + data dir, systemd unit                   |
| `install.ps1`    | Windows 10/11, Server      | Download panel binary, register Windows service (WinSW)                       |
| `proxmox-lxc.sh` | Proxmox VE host            | Create Debian LXC (prompts for CPU/RAM/disk/storage), run `install.sh` inside |

- Java is not installed by the scripts; the panel downloads the Temurin JRE each instance needs.
- Scripts print the panel URL and first-run setup link when done.
- Re-running a script upgrades in place.

## Milestones

Estimates assume one developer working part-time (evenings).

1. **Core** (~2 weeks): Bun adapter, Drizzle schema, auth + first-run setup, runner process, start/stop, live console, Vanilla + Paper/Purpur, auto-start on boot, instance page shell with Console and Settings.
2. **Loaders** (~1–1.5 weeks): Fabric, Quilt, Forge, NeoForge, Java auto-download.
3. **Mods** (~2.5 weeks): Modrinth + CurseForge search/install/update, dependency resolution, modpack import, resource pack manager.
   - **3b. Modpack builder** (~2 weeks, estimate): `/modpacks` list and editor, mod search and pinning with dependency resolution, config files, revisions, the "From local" tab, replacing the sidebar's Mods item.
4. **Operations** (~3 weeks): file manager (done), logs viewer (done), `server.properties` editor (done), backups (done, scheduling pending), loader update (done), player management, scheduled tasks, live stats, the dashboard (system KPI cards and the instances table), permissions UI.
5. **Install** (~1 week): `install.sh`, `install.ps1`, `proxmox-lxc.sh`, `bun build --compile` release binaries + CI.

## Future features

Not built, deliberately. Custom resource pack upload was implemented once and then removed (commit `4bb5df5` has a working version to start from) because its cost and exposure outweighed the benefit for now. Custom mod upload was never built.

### Custom resource pack upload

Upload a `.zip` and use it as the server pack instead of a Modrinth one.

- Validation: a real zip with `pack.mcmeta` at its top (nested is rejected, Minecraft rejects it too), at most 250 MB (the client's own limit).
- A server resource pack is fetched by players over HTTP, so the panel has to serve it. That needs a public, unauthenticated route (it was `/packs/<instance>/<sha1>.zip`, serving only the instance's current uploaded pack under its own sha1) and an address players can reach.
- Needs an admin-set "public address of this panel", with pack URLs rewritten when it changes, and a warning when it is a local address.
- Prefer serving packs from a separate pack-only listener on its own port, so a tunnel (playit.gg and similar raw TCP tunnels) or reverse proxy can expose just that port and the panel stays private. Exposing the whole panel to serve one file is the main downside of the first version.
- Costs: players download up to 250 MB each from the host (bandwidth), the adapter's default 512 KB request limit has to be raised for uploads, and free tunnel addresses can change, which makes every player download again.
- Implementation notes: SvelteKit hands remote-form files over as a lazy `Blob`, not a `File`, so validate with `instanceof Blob`; the shadcn `Input` binds `value` on file inputs and clears the chosen file, so use a plain file input there.

### Custom mod and plugin file upload

Drop in a `.jar` that is not on Modrinth or CurseForge (private mods, forks, plugins from other sites).

- Stored in `mods/` or `plugins/`, tracked as a manually installed entry (no project or version ids, so no update checks, no dependency resolution, no compatibility filter).
- Validate that it is a jar with the expected metadata (`fabric.mod.json`, `quilt.mod.json`, `META-INF/mods.toml`, `neoforge.mods.toml`, `plugin.yml` or `paper-plugin.yml`) and warn when it does not match the instance's loader.
- Show a clear note that it is unverified third-party code, since it runs with the server's permissions.
- Handle name clashes with existing files, and removal.
- Uploads need the same raised request limit as resource packs.

### Custom modpack upload

Bring an existing modpack file into "From local" (and into the builder, to edit it).

- Formats: `.mrpack` and CurseForge manifest zips. The Modrinth importer already reads `.mrpack` (index parsing, host allowlist, overrides, its own zip reader), so what is missing is an upload path and a way to keep the file as a local pack.
- Uploads need the adapter's request limit raised (it defaults to 512 KB, and packs can be hundreds of MB; the importer caps a pack at 600 MB) or a streaming upload endpoint that writes straight to disk, because a form upload is read into memory.
- Open decision: do imported packs become editable builder packs (parsed into pinned mod entries) or stay read-only files?

### Other ideas

- Builder: export a pack as `.mrpack`; CurseForge mods in the builder; snapshot an existing instance into a builder pack; apply a newer pack revision to an instance created from it.

- CurseForge integration: API key entered by the admin in Settings (the `settings` table already exists for it), then the same search, install and update flow as Modrinth.
- Pack-only listener port (see above), which also suits future features that need a public download.

## Open questions

- Panel self-update from the UI?
