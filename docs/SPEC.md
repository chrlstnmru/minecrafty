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

| Layer    | Choice                                                          |
| -------- | --------------------------------------------------------------- |
| Runtime  | Bun                                                             |
| Web      | SvelteKit (Svelte 5) with a Bun adapter (needed for WebSockets) |
| UI       | shadcn-svelte + Tailwind 4, `dashboard-01` block as app shell   |
| Database | SQLite via `bun:sqlite` + Drizzle ORM                           |
| Java     | Eclipse Temurin JDK 8 / 17 / 21, downloaded on demand           |

## Architecture

```
Browser ──HTTP/WS──> Panel (SvelteKit on Bun)
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
- Version picker fed by each loader's official API/metadata.
- Settings: name, RAM min/max, JVM args, Java version (auto-picked from MC version, overridable), port, auto-start on boot.
- Actions: start, stop, restart, kill, delete.
- Live console over WebSocket with command input and history.
- `server.properties` editor with form fields for common keys.
- EULA prompt before first start.

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

## Install scripts

| Script           | Target                     | Does                                                                          |
| ---------------- | -------------------------- | ----------------------------------------------------------------------------- |
| `install.sh`     | Debian/Ubuntu, Proxmox LXC | Install Bun, download panel release, create user + data dir, systemd unit     |
| `install.ps1`    | Windows 10/11, Server      | Install Bun, download panel release, register Windows service (WinSW)         |
| `proxmox-lxc.sh` | Proxmox VE host            | Create Debian LXC (prompts for CPU/RAM/disk/storage), run `install.sh` inside |

- Java is not installed by the scripts; the panel downloads the Temurin JDK each instance needs.
- Scripts print the panel URL and first-run setup link when done.
- Re-running a script upgrades in place.

## Milestones

Estimates assume one developer working part-time (evenings).

1. **Core** (~2 weeks): Bun adapter, Drizzle schema, auth + first-run setup, runner process, start/stop, live console, Vanilla + Paper/Purpur.
2. **Loaders** (~1–1.5 weeks): Fabric, Quilt, Forge, NeoForge, Java auto-download.
3. **Mods** (~2 weeks): Modrinth + CurseForge search/install/update, dependency resolution, modpack import.
4. **Operations** (~2 weeks): file manager, backups, scheduled tasks, live stats, permissions UI.
5. **Install** (~1 week): `install.sh`, `install.ps1`, `proxmox-lxc.sh`, release packaging.

## Open questions

- Release packaging: ship a `bun build --compile` single binary, or the SvelteKit build + Bun?
- Port allocation: auto-assign from a range, or always ask?
- Panel self-update from the UI?
