# Minecrafty

A self-hosted panel that runs and manages Minecraft servers on one machine, for an owner and the people they share servers with.

## Servers

**Instance**:
One Minecraft server the panel manages: its settings, its server folder, its backups and schedules.
_Avoid_: server (alone), world, container

**Server folder**:
The folder an instance's Minecraft server runs in: the jar, the configs, the mods, the world.
_Avoid_: instance folder, root

**Runner**:
The small process that owns a running instance's Java process, outlives panel restarts, and relays its console.
_Avoid_: agent, daemon, wrapper

**Running**:
An instance whose runner reports its server as starting, running or stopping. An exited server is not running.

**Console**:
The live output of a running server, with a line typed into it as a command.
_Avoid_: terminal, log (a log is a file on disk)

**Log**:
A file the server wrote under `logs/`: `latest.log` or a rotated one.

**World**:
The world folders inside a server folder, named by `level-name` plus its Nether and End. Never changed under a running server.

**RCON**:
The panel's own connection into a running server, used to list and manage players. Switched on at every start.

## Loaders and versions

**Loader**:
What a server runs on: Vanilla, Paper, Purpur, Fabric, Quilt, Forge or NeoForge.
_Avoid_: platform, software, type

**Loader build**:
One release of a loader for one Minecraft version. The newest is used unless a user picks another.
_Avoid_: loader version (when talking to users)

**Mod**:
A file a modded server loads from `mods/`. On Paper and Purpur the same idea is a **plugin**, in `plugins/`.

**Side**:
Where a mod runs, from its Modrinth project: client, server, or both. A client-only mod is useless on a server.

## Packs

**Modpack**:
A pack published on Modrinth, installed as a whole: loader, Minecraft version, mods and configs.
_Avoid_: Modrinth pack (in the UI)

**Pack**:
A modpack made in the panel's builder: a loader, a Minecraft version, pinned mods and config files.
_Avoid_: local pack, custom modpack

**Revision**:
The number of a pack's saved state; every saved change adds one. A server made from a pack remembers its revision.

**Origin**:
Where an instance's server came from: a loader alone, a modpack, or a pack. Only a loader-only install can be retried; a pack's servers follow the pack for their loader and Minecraft version.

**Server pack**:
The one resource pack a server offers its players, by Modrinth URL.
_Avoid_: texture pack, resource pack (when the server's chosen one is meant)

## Work on an instance

**Install**:
Putting a new instance's server files in place, in the background, while the instance shows as installing. It ends ready or failed.

**Update**:
Replacing an existing instance's server files with a new loader build, Minecraft version or modpack version. It is built beside the server and swapped in, so a failure before the swap leaves the server as it was.

**Outcome**:
How the last update of an instance ended, shown on its page until the panel restarts.

**Busy**:
An instance whose server folder is being restored, installed or updated. Nothing else may change its files then.

**Backup**:
A zip of a server folder, kept outside it. Its kind says why it exists: manual, scheduled, before a restore, before an update. The last two are never pruned.

**Restore**:
Replacing a stopped instance's server folder with a backup, after backing up what was there.

**Schedule**:
A task an instance runs on a cron timetable: start, stop, restart, back up, or a console command.
_Avoid_: job, cron job

## Files

**Protected file**:
A file the server cannot start without (`server.jar`, `eula.txt`, the launcher scripts, `libraries/`). It can be edited but not deleted, renamed or replaced.

**Host code**:
A file the server or the machine would run as code (`.jar`, scripts, `user_jvm_args.txt`). Only the owner may add or change one.

**Draft**:
The text of a file opened in an editor, kept until it is saved or discarded. A draft follows its file when the file is moved or renamed, and goes when the file is deleted.
_Avoid_: buffer, unsaved copy

## People and access

**Owner**:
The one account that set up the panel. It may do everything, including what runs code on the machine.
_Avoid_: admin, root

**User**:
Any other account. It may do only what its roles grant.

**Role**:
A named set of permissions, given to a user panel-wide or for one instance. Roles are ranked; a user may manage only roles below their own.

**Permission**:
One thing a role allows. A **panel permission** covers the panel as a whole (creating instances, users, roles, packs); an **instance permission** covers one instance (console, files, backups and so on).

**Tab**:
One page of an instance (Console, Files, Mods, Backups…), shown to a user only with the permission behind it.
_Avoid_: module (in the domain sense)

**Audit entry**:
One line of who did what, and when, to the panel or an instance. Work that finishes later is credited to whoever started it; work with no person behind it is credited to the panel.
_Avoid_: event, activity

**Setup code**:
The one-time code that lets the first visitor create the owner account.
_Avoid_: setup token (in the UI)
