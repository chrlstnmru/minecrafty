#!/usr/bin/env bash
# Installs or upgrades the Minecrafty panel on Debian or Ubuntu (a Proxmox LXC container included).
#
#   curl -fsSL https://raw.githubusercontent.com/chrlstnmru/minecrafty/main/scripts/install.sh | sudo bash
#
# Run it again to upgrade in place: it fetches the newest release, and only restarts the panel when
# the binary changed. Game servers keep running through an upgrade (see KillMode in the unit).
#
# Options:   --uninstall   remove the service and the program, keeping the data
#            --purge       with --uninstall, remove the data too (worlds, backups, accounts)
#            --no-service  install the files but do not touch systemd
# Variables: MINECRAFTY_REPO     GitHub "owner/name" to download from
#            MINECRAFTY_VERSION  a tag such as v0.1.0 (default: the latest release)
#            MINECRAFTY_PORT     the port the panel listens on (default 3000; used on first install)
#            MINECRAFTY_BINARY   a local file to install instead of downloading one
#
# Java is not installed here: the panel downloads the Temurin JRE each server needs.
set -euo pipefail

REPO="${MINECRAFTY_REPO:-chrlstnmru/minecrafty}"
VERSION="${MINECRAFTY_VERSION:-latest}"
PORT="${MINECRAFTY_PORT:-3000}"
LOCAL_BINARY="${MINECRAFTY_BINARY:-}"

# MINECRAFTY_ROOT puts everything under another directory, for trying the script without root
ROOT="${MINECRAFTY_ROOT:-}"
SERVICE_USER=minecrafty
INSTALL_DIR="$ROOT/opt/minecrafty"
BINARY="$INSTALL_DIR/minecrafty"
DATA_DIR="$ROOT/var/lib/minecrafty"
ENV_DIR="$ROOT/etc/minecrafty"
ENV_FILE="$ENV_DIR/minecrafty.env"
UNIT_FILE="$ROOT/etc/systemd/system/minecrafty.service"

UNINSTALL=0
PURGE=0
NO_SERVICE=0
for arg in "$@"; do
  case "$arg" in
    --uninstall) UNINSTALL=1 ;;
    --purge) PURGE=1 ;;
    --no-service) NO_SERVICE=1 ;;
    -h | --help)
      sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
  esac
done
[ -n "$ROOT" ] && NO_SERVICE=1

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

if [ -z "$ROOT" ] && [ "$(id -u)" -ne 0 ]; then
  die "run this as root (for example: sudo bash install.sh)"
fi

# ---- uninstall ----
if [ "$UNINSTALL" -eq 1 ]; then
  if [ "$NO_SERVICE" -eq 0 ] && command -v systemctl > /dev/null; then
    systemctl disable --now minecrafty 2> /dev/null || true
  fi
  rm -f "$UNIT_FILE" "$BINARY"
  rmdir "$INSTALL_DIR" 2> /dev/null || true
  [ "$NO_SERVICE" -eq 0 ] && command -v systemctl > /dev/null && systemctl daemon-reload
  if [ "$PURGE" -eq 1 ]; then
    rm -rf "$DATA_DIR" "$ENV_DIR"
    say "Removed Minecrafty and its data."
  else
    say "Removed Minecrafty. Your data is still in $DATA_DIR (use --purge to delete it)."
  fi
  exit 0
fi

# ---- what to download ----
case "$(uname -m)" in
  x86_64 | amd64) ASSET=minecrafty-linux-x64 ;;
  aarch64 | arm64) ASSET=minecrafty-linux-arm64 ;;
  *) die "unsupported CPU: $(uname -m)" ;;
esac

missing=()
for tool in curl tar sha256sum; do
  command -v "$tool" > /dev/null || missing+=("$tool")
done
if [ "${#missing[@]}" -gt 0 ] && [ -z "$LOCAL_BINARY" ]; then
  if command -v apt-get > /dev/null; then
    say "Installing ${missing[*]}"
    apt-get update -qq
    # tar is how the panel unpacks the Java it downloads; coreutils has sha256sum
    apt-get install -y -qq curl ca-certificates tar coreutils
  else
    die "needs ${missing[*]}; install them and run this again"
  fi
fi

if [ "$VERSION" = latest ]; then
  BASE="https://github.com/$REPO/releases/latest/download"
else
  BASE="https://github.com/$REPO/releases/download/$VERSION"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ -n "$LOCAL_BINARY" ]; then
  [ -f "$LOCAL_BINARY" ] || die "$LOCAL_BINARY does not exist"
  cp "$LOCAL_BINARY" "$TMP/$ASSET"
else
  say "Downloading $ASSET ($VERSION)"
  curl -fsSL --retry 3 -o "$TMP/$ASSET" "$BASE/$ASSET" || die "could not download $BASE/$ASSET"
  curl -fsSL --retry 3 -o "$TMP/SHA256SUMS" "$BASE/SHA256SUMS" || die "could not download the checksums"
  expected="$(grep " $ASSET\$" "$TMP/SHA256SUMS" | cut -d' ' -f1)"
  [ -n "$expected" ] || die "$ASSET is not in the release's checksums"
  actual="$(sha256sum "$TMP/$ASSET" | cut -d' ' -f1)"
  [ "$expected" = "$actual" ] || die "the download does not match its checksum; not installing it"
fi
chmod 0755 "$TMP/$ASSET"

# ---- account and folders ----
if [ -z "$ROOT" ] && ! id "$SERVICE_USER" > /dev/null 2>&1; then
  say "Creating the $SERVICE_USER user"
  useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi
install -d -m 0755 "$INSTALL_DIR" "$ENV_DIR" "$(dirname "$UNIT_FILE")"
install -d -m 0750 "$DATA_DIR"
[ -z "$ROOT" ] && chown "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"

# ---- the program ----
CHANGED=1
if [ -f "$BINARY" ] && cmp -s "$TMP/$ASSET" "$BINARY"; then
  CHANGED=0
  say "Already up to date"
else
  say "Installing the program"
  install -m 0755 "$TMP/$ASSET" "$BINARY.new"
  mv -f "$BINARY.new" "$BINARY"
fi

# ---- settings, kept as the owner edited them ----
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" << EOF
# Settings for the Minecrafty service. Restart it after changing them: systemctl restart minecrafty
PORT=$PORT
HOST=0.0.0.0
MINECRAFTY_DATA=$DATA_DIR
# Behind a reverse proxy that sets X-Forwarded-Proto, nothing else is needed for https. To name
# another header, set PROTOCOL_HEADER (and HOST_HEADER if the proxy rewrites the host). Also set
# ADDRESS_HEADER=X-Forwarded-For there, so failed sign-ins are counted per visitor, not per proxy.
EOF
fi
PORT="$(grep -E '^PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2)"
PORT="${PORT:-3000}"

if [ "$NO_SERVICE" -eq 1 ]; then
  say "Installed $BINARY (no service set up)"
  exit 0
fi

# ---- the service ----
# KillMode=process: stopping or restarting the panel stops only the panel. Each game server runs
# in its own runner process, and those keep going, so an upgrade does not kick the players.
cat > "$UNIT_FILE" << EOF
[Unit]
Description=Minecrafty server panel
After=network-online.target
Wants=network-online.target

[Service]
User=$SERVICE_USER
Group=$SERVICE_USER
EnvironmentFile=$ENV_FILE
WorkingDirectory=$DATA_DIR
ExecStart=$BINARY
Restart=on-failure
RestartSec=3
KillMode=process
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable minecrafty > /dev/null 2>&1
if [ "$CHANGED" -eq 1 ] || ! systemctl is-active --quiet minecrafty; then
  say "Starting the panel"
  systemctl restart minecrafty
fi

for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/login" 2> /dev/null || curl -fsS -o /dev/null "http://127.0.0.1:$PORT/setup" 2> /dev/null; then
    UP=1
    break
  fi
  sleep 1
done
[ "${UP:-0}" -eq 1 ] || die "the panel did not start; see: journalctl -u minecrafty -n 50"

IP="$(hostname -I 2> /dev/null | awk '{print $1}')"
IP="${IP:-localhost}"
say "Minecrafty is running"
if curl -fsS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/setup" 2> /dev/null | grep -q '^200$'; then
  echo "    First run: open  http://$IP:$PORT/setup  to create the owner account."
  [ -f "$DATA_DIR/setup-token.txt" ] && echo "    Setup code: $(cat "$DATA_DIR/setup-token.txt")"
else
  echo "    Open  http://$IP:$PORT"
fi
echo "    Data:     $DATA_DIR"
echo "    Settings: $ENV_FILE"
echo "    Logs:     journalctl -u minecrafty -f"
