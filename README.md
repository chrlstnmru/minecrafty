# Minecrafty

A self-hosted panel for running Minecraft servers: Vanilla, Paper, Purpur, Fabric, Quilt, Forge and
NeoForge, with a live console, files, mods and modpacks (Modrinth), backups, scheduled tasks, players,
users and roles, and a modpack builder. See [docs/SPEC.md](docs/SPEC.md) for what it does in detail.

## Install

**Debian or Ubuntu** (a Proxmox container works too), as root:

```sh
curl -fsSL https://raw.githubusercontent.com/chrlstnmru/minecrafty/main/scripts/install.sh | bash
```

It installs one program to `/opt/minecrafty`, keeps data in `/var/lib/minecrafty`, and runs it as a
systemd service on port 3000. Open `http://<the machine>:3000/setup` and make the owner account.
Run it again to upgrade; game servers keep running through the upgrade.

**Proxmox VE**, on the host, to make a container and install in it:

```sh
bash -c "$(curl -fsSL https://raw.githubusercontent.com/chrlstnmru/minecrafty/main/scripts/proxmox-lxc.sh)"
```

**Windows 10/11 or Server**, from an elevated PowerShell:

```powershell
irm https://raw.githubusercontent.com/chrlstnmru/minecrafty/main/scripts/install.ps1 | iex
```

Java is not needed up front: the panel downloads the Temurin JRE each server needs. The scripts
download from `chrlstnmru/minecrafty`; to use a fork, set `MINECRAFTY_REPO` (or `-Repo` on Windows).

Settings (port, data folder) are in `/etc/minecrafty/minecrafty.env`. Behind a reverse proxy that sets
`X-Forwarded-Proto`, set `ADDRESS_HEADER=X-Forwarded-For` so failed sign-ins are counted per
visitor and not for the proxy as a whole. To remove it: `install.sh --uninstall` (add `--purge` to
delete the data too).

## Develop

You need [Bun](https://bun.sh) 1.4 or newer.

```sh
bun install
bun run dev        # the panel, with hot reload
bun run check      # types
bun run lint
bun run test
```

The plain build runs with `bun build/index.js` (`bun run build`). To build the single executable
(the client files, the database migrations and the per-server runner are inside it):

```sh
MINECRAFTY_COMPILE=1 bun run build               # for this machine, at build/server
MINECRAFTY_COMPILE=bun-linux-arm64 bun run build  # another target
```

Data lives in `./data` while developing; set `MINECRAFTY_DATA` to move it.

## Release

Push a tag such as `v0.1.0`. `.github/workflows/release.yml` checks, builds the Linux x64, Linux
arm64 and Windows x64 executables, and publishes them with `SHA256SUMS`; the install scripts download
from that release.
