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

## Stack

| Layer    | Choice                                                              |
| -------- | ------------------------------------------------------------------- |
| Runtime  | Bun                                                                 |
| Web      | SvelteKit (Svelte 5) with `@sveltejs/adapter-bun`, remote functions |
| UI       | shadcn-svelte (+ extras) + Tailwind 4, `dashboard-01` app shell     |
| Database | SQLite via `bun:sqlite` + Drizzle ORM                               |
| Java     | Eclipse Temurin JDK 8 / 17 / 21, downloaded on demand               |
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
- Settings: name, RAM min/max, JVM args, Java version (auto-picked from MC version, overridable), port, auto-start on boot. Ports are auto-assigned from 25565 upward and editable.
- Actions: start, stop, restart, kill, delete.
- Live console via `query.live` (streamed over HTTP, no WebSocket) with command input and history. Each frame repeats the most recent lines and clients merge by sequence number, because live queries only keep the latest pending value.
- `server.properties` editor with form fields for common keys.
- EULA must be accepted when the instance is created.

### Instance page

Each instance has a dedicated page, `/instances/[id]`, with a shared header (name, loader and version, port, status, start/stop/kill) and a tab bar. Every module is its own nested route (`/instances/[id]/console`, `/files`, ...) so it can be linked to and loaded on its own. Modules not yet built show a "planned" placeholder.

| Module         | Purpose                                                                                | Milestone |
| -------------- | -------------------------------------------------------------------------------------- | --------- |
| Console        | Live server output with command input and history                                      | 1         |
| Settings       | Name, RAM, JVM args, port, auto-start, delete                                          | 1         |
| Mods           | Search, install, update, remove mods; track installed mods                             | 3         |
| Resource packs | Browse and install resource packs (Modrinth/CurseForge), server resource-pack settings | 3         |
| Shader packs   | Browse and install shader packs (Modrinth/CurseForge)                                  | 3         |
| Files          | File manager and text editor, limited to the instance root                             | 4         |
| Logs           | Browse `logs/latest.log` and rotated `.gz` files with search and download              | 4         |
| Properties     | `server.properties` editor with form fields for common keys                            | 4         |
| Players        | Online players, whitelist, ops, bans, kick (RCON)                                      | 4         |
| Backups        | Manual and scheduled backups, restore                                                  | 4         |
| Schedules      | Cron tasks for this instance                                                           | 4         |
| Loader         | Update the loader build or Minecraft version, with a backup prompt                     | 4         |

Console is the live server output with command input; Logs is the history of log files on disk.

### Loaders

| Loader         | Source                     | Notes                                                                                             |
| -------------- | -------------------------- | ------------------------------------------------------------------------------------------------- |
| Vanilla        | Mojang version manifest    |                                                                                                   |
| Paper / Purpur | PaperMC API / Purpur API   | Plugins, not mods                                                                                 |
| Fabric / Quilt | Fabric meta / Quilt meta   | Download server launcher jar directly                                                             |
| Forge          | Forge maven + installer    | Run installer headless (`--installServer`); handle `run.sh` / `@libraries/.../args.txt` for 1.17+ |
| NeoForge       | NeoForge maven + installer | Same as Forge                                                                                     |

### Mods and modpacks

- Search Modrinth and CurseForge from the instance page, filtered by the instance's loader and MC version.
- Install, update, remove; resolve required dependencies.
- Track installed mods (source, project ID, file ID, hash) in the DB so updates can be checked.
- Modpack import: Modrinth `.mrpack` and CurseForge manifest zips; create a new instance from the pack.
- CurseForge files with third-party downloads disabled: list them for manual download and accept uploads.
- CurseForge API key: entered by the admin in Settings. No key ships with the project. Modrinth needs no key.
- Server-side only: skip client-only mods where metadata says so.

### File manager

- Browse, create, rename, delete, upload, download (zip folders) inside the instance root only.
- Text editor for configs (`.properties`, `.json`, `.toml`, `.yml`, `.cfg`, `.txt`).
- Path traversal protection on every file operation.

### Backups

- Manual and scheduled zip backups of the instance root (configurable excludes).
- Retention: keep last N.
- Restore (instance must be stopped). Download a backup.
- Run `save-off` / `save-all` before and `save-on` after when the server is running.

### Scheduled tasks

- Cron expressions per instance.
- Actions: start, stop, restart, backup, send console command.
- Optional in-game warning before restart/stop.

### Live stats

- Per instance: CPU and RAM of the Java process, uptime, status.
- Players online and player list via RCON or server query (panel enables RCON with a random password on creation).
- Host overview on the dashboard: CPU, RAM, disk.

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

- Java is not installed by the scripts; the panel downloads the Temurin JDK each instance needs.
- Scripts print the panel URL and first-run setup link when done.
- Re-running a script upgrades in place.

## Milestones

Estimates assume one developer working part-time (evenings).

1. **Core** (~2 weeks): Bun adapter, Drizzle schema, auth + first-run setup, runner process, start/stop, live console, Vanilla + Paper/Purpur, auto-start on boot, instance page shell with Console and Settings.
2. **Loaders** (~1–1.5 weeks): Fabric, Quilt, Forge, NeoForge, Java auto-download.
3. **Mods** (~2.5 weeks): Modrinth + CurseForge search/install/update, dependency resolution, modpack import, resource pack and shader pack managers.
4. **Operations** (~3 weeks): file manager, logs viewer, `server.properties` editor, player management, loader update, backups, scheduled tasks, live stats, permissions UI.
5. **Install** (~1 week): `install.sh`, `install.ps1`, `proxmox-lxc.sh`, `bun build --compile` release binaries + CI.

## Open questions

- Panel self-update from the UI?
