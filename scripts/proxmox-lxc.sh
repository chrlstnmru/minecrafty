#!/usr/bin/env bash
# Creates a Debian container on a Proxmox VE host and installs Minecrafty in it.
# Run it as root on the Proxmox host (not inside a container):
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/chrlstnmru/minecrafty/main/scripts/proxmox-lxc.sh)"
#
# It asks for the container's CPU, memory, disk and storage (press Enter to accept the default in
# brackets), then runs install.sh inside it. Set the variables below to skip the questions.
# Variables: MINECRAFTY_REPO  GitHub "owner/name" to download from (default chrlstnmru/minecrafty)
#            CTID  HOSTNAME  CORES  MEMORY_MB  DISK_GB  STORAGE  BRIDGE
set -euo pipefail

REPO="${MINECRAFTY_REPO:-chrlstnmru/minecrafty}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

command -v pct > /dev/null && command -v pveam > /dev/null || die "this must run on a Proxmox VE host"
[ "$(id -u)" -eq 0 ] || die "run this as root"

ask() { # ask VARIABLE "question" default
  local name="$1" question="$2" default="$3" value
  if [ -n "${!name:-}" ]; then return; fi
  read -r -p "$question [$default]: " value < /dev/tty
  printf -v "$name" '%s' "${value:-$default}"
}

NEXT_ID="$(pvesh get /cluster/nextid)"
FIRST_STORAGE="$(pvesm status --content rootdir | awk 'NR==2 {print $1}')"
ask CTID "Container ID" "$NEXT_ID"
ask HOSTNAME "Hostname" "minecrafty"
ask CORES "CPU cores" "2"
ask MEMORY_MB "Memory (MB), plus what the game servers need" "4096"
ask DISK_GB "Disk (GB), for worlds, mods and backups" "20"
ask STORAGE "Storage for the container's disk" "${FIRST_STORAGE:-local-lvm}"
ask BRIDGE "Network bridge" "vmbr0"

pct status "$CTID" > /dev/null 2>&1 && die "container $CTID already exists"

say "Getting the Debian template"
pveam update > /dev/null
TEMPLATE="$(pveam available --section system | awk '/debian-12-standard/ {print $2}' | sort -V | tail -1)"
[ -n "$TEMPLATE" ] || die "no Debian 12 template is available"
if ! pveam list "$TEMPLATE_STORAGE" | grep -q "$TEMPLATE"; then
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE"
fi

say "Creating container $CTID ($HOSTNAME)"
pct create "$CTID" "$TEMPLATE_STORAGE:vztmpl/$TEMPLATE" \
  --hostname "$HOSTNAME" \
  --cores "$CORES" \
  --memory "$MEMORY_MB" \
  --swap 512 \
  --rootfs "$STORAGE:$DISK_GB" \
  --net0 "name=eth0,bridge=$BRIDGE,ip=dhcp" \
  --unprivileged 1 \
  --features nesting=1 \
  --onboot 1 \
  --description "Minecrafty server panel"
pct start "$CTID"

say "Waiting for the network"
for _ in $(seq 1 30); do
  if pct exec "$CTID" -- getent hosts github.com > /dev/null 2>&1; then
    ONLINE=1
    break
  fi
  sleep 2
done
[ "${ONLINE:-0}" -eq 1 ] || die "the container has no network; check the bridge and DHCP, then run: pct exec $CTID -- bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/$REPO/main/scripts/install.sh)\""

say "Installing Minecrafty"
pct exec "$CTID" -- bash -c "apt-get update -qq && apt-get install -y -qq curl ca-certificates tar"
pct exec "$CTID" -- env MINECRAFTY_REPO="$REPO" \
  bash -c "curl -fsSL https://raw.githubusercontent.com/$REPO/main/scripts/install.sh | bash"

say "Done. Container $CTID is set to start with the host."
