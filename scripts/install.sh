#!/usr/bin/env bash
#
# scripts/install.sh — puts the btcnode dashboard on a Raspberry Pi.
#
# What it does, in order:
#   1. Docker Engine + Compose plugin from Docker's apt repository (if missing)
#   2. finds where bitcoind and the Electrum server run — as systemd units
#      or as Docker containers — and installs the host agent accordingly
#   3. the RPC account `dashboard` in bitcoin.conf, read-only whitelist
#   4. secrets: RPC password, admin password hash, session key
#   5. a self-signed TLS certificate
#   6. deploy/.env from what it finds on this machine
#   7. a firewall rule for the web port, home network only
#   8. pulls the two signed images from GHCR — scripts/deploy-pull.sh, which
#      checks their cosign signatures first — starts them, checks the page
#      answers. With --build it builds them from this checkout instead.
#
# Repeatable: running it twice changes nothing that is already right.
#
# Usage:  sudo bash scripts/install.sh [--web-port 443] [--http-port 80] [--lan 192.168.0.0/16] [--build] [--yes]
#         sudo BITCOIN_DATA_DIR=/path/to/datadir bash scripts/install.sh   (if it is not found)
#         sudo BITCOIND_CONTAINER=name bash scripts/install.sh           (bitcoind in Docker, if not detected)
#
# Pick other ports (say 8443/8080) if something else already serves 443/80
# on this machine; the page then answers on https://…:8443.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY="$REPO/deploy"
AGENT_LIB="/usr/local/lib/btcnode"
UNIT_DIR="/etc/systemd/system"
WEB_PORT=443
HTTP_PORT=80
LAN=""
ASSUME_YES=0
BUILD_LOCAL=0
RPC_METHODS="getblockchaininfo,getnetworkinfo,getmempoolinfo,uptime,getpeerinfo,getblockstats,getnetworkhashps,estimatesmartfee"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --web-port) WEB_PORT="${2:?--web-port needs a value}"; shift 2 ;;
    --http-port) HTTP_PORT="${2:?--http-port needs a value}"; shift 2 ;;
    --lan) LAN="${2:?--lan needs a value}"; shift 2 ;;
    --build) BUILD_LOCAL=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

if [[ -t 1 ]]; then BOLD=$'\e[1m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; RESET=$'\e[0m'; else BOLD=""; GREEN=""; YELLOW=""; RED=""; RESET=""; fi
title() { printf '\n%s== %s ==%s\n' "$BOLD" "$*" "$RESET"; }
ok()    { printf '  %s[ok]%s %s\n' "$GREEN" "$RESET" "$*"; }
note()  { printf '  %s[..]%s %s\n' "$YELLOW" "$RESET" "$*"; }
fail()  { printf '  %s[!!]%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }
ask() {
  # ask "question" default(y|n) — with --yes or without a terminal the default applies
  local q="$1" d="${2:-n}" a
  if [[ $ASSUME_YES -eq 1 || ! -t 0 ]]; then [[ "$d" == y ]]; return; fi
  read -r -p "  $q [$([[ $d == y ]] && echo Y/n || echo y/N)] " a
  a="${a:-$d}"; [[ "$a" =~ ^[Yy] ]]
}
deploy_pull() {
  # the signed images from GHCR; deploy-pull.sh verifies before it pulls
  local yes=()
  [[ $ASSUME_YES -eq 1 ]] && yes=(--yes)
  bash "$REPO/scripts/deploy-pull.sh" "${yes[@]}" "$@"
}

[[ $EUID -eq 0 ]] || fail "run as root: sudo bash scripts/install.sh"
[[ "$WEB_PORT" =~ ^[0-9]+$ && "$WEB_PORT" -ge 1 && "$WEB_PORT" -le 65535 ]] || fail "--web-port must be a port number"

# ------------------------------------------------------------------ 1. Docker
title "Docker"
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  ok "docker $(docker --version | sed 's/Docker version //;s/,.*//') with compose plugin"
else
  ask "Install Docker Engine from Docker's apt repository?" y || fail "Docker is required"
  . /etc/os-release
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg >/dev/null
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
  systemctl enable --now docker
  ok "Docker installed"
fi

# --------------------------------------------------- 2. Where do things run?
title "Node services"
# A role is a systemd unit of that name, or a Docker container whose name or
# image says what it is. The agent restarts whichever it is; the dashboard
# reads the journal for a unit and debug.log for a container.
unit_present() { [[ "$(systemctl show -p LoadState --value "$1" 2>/dev/null)" == "loaded" ]]; }
find_container() {
  # $1: pattern on name or image; prints the first match. Our own two
  # containers are skipped — on a second run "btcnode-api" matches "btc".
  docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null \
    | awk -v re="$1" '$1 !~ /^btcnode-/ && tolower($0) ~ re {print $1; exit}'
}
AGENT_UNITS=""
AGENT_CONTAINERS=""
NODE_UNMANAGED=0
BITCOIND_CONTAINER="${BITCOIND_CONTAINER:-}"
if unit_present bitcoind; then
  ok "bitcoind: systemd unit"
  AGENT_UNITS="bitcoind"
else
  [[ -n "$BITCOIND_CONTAINER" ]] || BITCOIND_CONTAINER="$(find_container 'bitcoin|btc')"
  if [[ -n "$BITCOIND_CONTAINER" ]]; then
    docker inspect "$BITCOIND_CONTAINER" >/dev/null 2>&1 || fail "no container named $BITCOIND_CONTAINER"
    ask "bitcoind seems to run in the container '$BITCOIND_CONTAINER'. Use it?" y \
      || fail "tell me which one: sudo BITCOIND_CONTAINER=name bash scripts/install.sh"
    ok "bitcoind: container $BITCOIND_CONTAINER"
    AGENT_CONTAINERS="bitcoind=$BITCOIND_CONTAINER"
  else
    # Started by hand, by cron, by something we do not know: the page still
    # works through RPC and the data directory, only the restart button is
    # not offered and the log comes from debug.log if there is one.
    NODE_UNMANAGED=1
    note "no bitcoind unit and no container found, using RPC and the data directory only;"
    note "the page will not offer a bitcoind restart (BITCOIND_CONTAINER=name if it is a container with an unusual name)"
  fi
fi
ELECTRS_CONTAINER=""
if unit_present electrs; then
  ok "electrs: systemd unit"
  AGENT_UNITS="${AGENT_UNITS:+$AGENT_UNITS,}electrs"
else
  ELECTRS_CONTAINER="$(find_container 'electrs|fulcrum|electrumx')"
  if [[ -n "$ELECTRS_CONTAINER" ]]; then
    ok "Electrum server: container $ELECTRS_CONTAINER"
    AGENT_CONTAINERS="${AGENT_CONTAINERS:+$AGENT_CONTAINERS,}electrs=$ELECTRS_CONTAINER"
  else
    note "no Electrum server found, the page will say so; set one up with scripts/node-setup/40-electrs.sh, containers: docs/install.md"
  fi
fi

# ------------------------------------------------------------------- 2. Agent
title "Host agent"
getent group btcnode >/dev/null || { groupadd --system btcnode; ok "group btcnode created"; }
install -d -m 0755 "$AGENT_LIB"
install -m 0755 "$REPO/agent/btcnode-agent.py" "$AGENT_LIB/btcnode-agent.py"
install -m 0644 "$REPO/agent/btcnode-agent.service" "$UNIT_DIR/btcnode-agent.service"
# What the agent may restart, as a drop-in: the unit file stays the repository's.
install -d -m 0755 "$UNIT_DIR/btcnode-agent.service.d"
cat > "$UNIT_DIR/btcnode-agent.service.d/roles.conf" <<EOF
# written by scripts/install.sh — which role is a unit and which a container
[Service]
Environment=BTCNODE_AGENT_UNITS=$AGENT_UNITS
Environment=BTCNODE_AGENT_CONTAINERS=$AGENT_CONTAINERS
EOF
systemctl daemon-reload
systemctl enable --now btcnode-agent >/dev/null
systemctl restart btcnode-agent
sleep 1
[[ -S /run/btcnode-agent/agent.sock ]] || fail "agent socket missing, see: journalctl -u btcnode-agent"
ok "btcnode-agent running, socket /run/btcnode-agent/agent.sock"

# ------------------------------------------------------- 3. bitcoin.conf / RPC
title "Bitcoin Core RPC account"
# The environment wins, then the container's mounts, then the usual places,
# then the old dashboard's config.
DATADIR="${BITCOIN_DATA_DIR:-}"
[[ -n "$DATADIR" && ! -f "$DATADIR/bitcoin.conf" ]] && fail "BITCOIN_DATA_DIR=$DATADIR has no bitcoin.conf"
if [[ -z "$DATADIR" && -n "$BITCOIND_CONTAINER" ]]; then
  # the bind mount on the host side that holds bitcoin.conf
  while read -r src; do
    [[ -n "$src" && -f "$src/bitcoin.conf" ]] && { DATADIR="$src"; break; }
    [[ -n "$src" && -f "$src/.bitcoin/bitcoin.conf" ]] && { DATADIR="$src/.bitcoin"; break; }
  done < <(docker inspect -f '{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}}{{"\n"}}{{end}}{{end}}' "$BITCOIND_CONTAINER")
  [[ -n "$DATADIR" ]] || fail "the container's bind mounts hold no bitcoin.conf. Run as: sudo BITCOIN_DATA_DIR=/path/on/host bash scripts/install.sh"
fi
for candidate in /mnt/bitcoin/bitcoin /var/lib/bitcoind /home/bitcoin/.bitcoin /data/bitcoin; do
  [[ -z "$DATADIR" ]] || break
  [[ -f "$candidate/bitcoin.conf" ]] && { DATADIR="$candidate"; break; }
done
if [[ -z "$DATADIR" ]] && [[ -f /etc/node-dashboard.conf ]]; then
  DATADIR="$(sed -n 's/^DATA_DIR=//p' /etc/node-dashboard.conf | tr -d "'\"")"
fi
[[ -n "$DATADIR" && -f "$DATADIR/bitcoin.conf" ]] || fail "bitcoin.conf not found. Run as:  sudo BITCOIN_DATA_DIR=/path/to/datadir bash scripts/install.sh"
CONF="$DATADIR/bitcoin.conf"
ok "bitcoin.conf: $CONF"

RPC_PASSWORD=""
# The previous dashboard's password, if this Pi ran one — nothing to re-key.
if [[ -f /etc/node-dashboard.conf ]]; then
  RPC_PASSWORD="$(sed -n 's/^RPC_PASSWORD=//p' /etc/node-dashboard.conf | tr -d "'\"")"
  [[ -n "$RPC_PASSWORD" ]] && ok "reusing the RPC password from /etc/node-dashboard.conf"
fi
# Or the one the setup scripts stored.
if [[ -z "$RPC_PASSWORD" && -f /etc/bitcoin-access.conf ]]; then
  RPC_PASSWORD="$(sed -n "s/^DASH_PASS='\(.*\)'$/\1/p" /etc/bitcoin-access.conf)"
  [[ -n "$RPC_PASSWORD" ]] && ok "reusing the RPC password from /etc/bitcoin-access.conf"
fi
# Or the one a previous run of this installer stored — the legacy files above
# may be gone once the old dashboard is cleaned up.
if [[ -z "$RPC_PASSWORD" && -s "$DEPLOY/secrets/rpc_password" ]]; then
  RPC_PASSWORD="$(head -n1 "$DEPLOY/secrets/rpc_password")"
  [[ -n "$RPC_PASSWORD" ]] && ok "reusing the RPC password from deploy/secrets/rpc_password"
fi
# rpcauth=dashboard without a known password would leave the api locked out.
if grep -q '^rpcauth=dashboard:' "$DATADIR/bitcoin.conf" && [[ -z "$RPC_PASSWORD" ]]; then
  fail "rpcauth=dashboard is set but its password is unknown. Remove that line from bitcoin.conf and run again"
fi
RESTART_BITCOIND=0
if ! grep -q '^rpcauth=dashboard:' "$CONF"; then
  [[ -n "$RPC_PASSWORD" ]] || RPC_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
  RPCAUTH="$(python3 - "$RPC_PASSWORD" <<'PY'
import hashlib, hmac, os, sys
pw = sys.argv[1]; salt = os.urandom(16).hex()
print(f"dashboard:{salt}${hmac.new(salt.encode(), pw.encode(), hashlib.sha256).hexdigest()}")
PY
)"
  # Above the first [section], or a conf ending in [test] would put the
  # account into the test network only.
  python3 - "$CONF" "rpcauth=$RPCAUTH" <<'PY'
import sys
path, line = sys.argv[1], sys.argv[2]
text = open(path).read().splitlines()
idx = next((i for i, l in enumerate(text) if l.strip().startswith('[')), len(text))
text.insert(idx, line)
open(path, 'w').write('\n'.join(text) + '\n')
PY
  RESTART_BITCOIND=1
  ok "rpcauth=dashboard added"
else
  [[ -n "$RPC_PASSWORD" ]] || fail "bitcoin.conf has an rpcauth=dashboard entry but its password is nowhere on this machine. Remove the line and run again"
  ok "rpcauth=dashboard present"
fi
WHITELIST="rpcwhitelist=dashboard:$RPC_METHODS"
if grep -q '^rpcwhitelist=dashboard:' "$CONF"; then
  if ! grep -qxF "$WHITELIST" "$CONF"; then
    sed -i "s|^rpcwhitelist=dashboard:.*|$WHITELIST|" "$CONF"
    RESTART_BITCOIND=1
    ok "rpcwhitelist for dashboard renewed"
  else
    ok "rpcwhitelist up to date"
  fi
else
  python3 - "$CONF" "$WHITELIST" "rpcwhitelistdefault=0" <<'PY'
import sys
path = sys.argv[1]
text = open(path).read().splitlines()
idx = next((i for i, l in enumerate(text) if l.strip().startswith('[')), len(text))
for line in reversed(sys.argv[2:]):
    if not any(l.strip() == line for l in text):
        text.insert(idx, line)
open(path, 'w').write('\n'.join(text) + '\n')
PY
  RESTART_BITCOIND=1
  ok "rpcwhitelist for dashboard added (read-only methods only)"
fi
if [[ $RESTART_BITCOIND -eq 1 ]]; then
  if [[ -n "$BITCOIND_CONTAINER" ]]; then
    RESTART_CMD="docker restart -t 120 $BITCOIND_CONTAINER"
  else
    RESTART_CMD="systemctl restart bitcoind"
  fi
  if (( NODE_UNMANAGED == 1 )); then
    note "restart bitcoind yourself, however you started it. The new RPC account works only after that"
  elif ask "bitcoin.conf changed. Restart bitcoind now? (a clean restart takes a minute)" n; then
    $RESTART_CMD >/dev/null && ok "bitcoind restarted"
  else
    note "restart bitcoind yourself before the dashboard can log in: sudo $RESTART_CMD"
  fi
fi

# The api container lives on the host network and asks 127.0.0.1. A bitcoind
# in its own container answers there only if its RPC port is published on
# localhost — without that the page would say "unreachable" and nothing else.
RPC_PORT="$(sed -n 's/^rpcport=//p' "$CONF" | head -1)"; RPC_PORT="${RPC_PORT:-8332}"
if python3 -c "import socket,sys; s=socket.socket(); s.settimeout(3); sys.exit(0 if s.connect_ex(('127.0.0.1', $RPC_PORT)) == 0 else 1)"; then
  ok "RPC answers on 127.0.0.1:$RPC_PORT"
elif [[ -n "$BITCOIND_CONTAINER" ]]; then
  fail "nothing listens on 127.0.0.1:$RPC_PORT. Publish the container's RPC port on localhost (-p 127.0.0.1:$RPC_PORT:$RPC_PORT, or network_mode: host) and run again"
elif (( NODE_UNMANAGED == 1 )); then
  fail "nothing listens on 127.0.0.1:$RPC_PORT and I do not know how bitcoind runs here. Start it, then run again"
else
  note "nothing listens on 127.0.0.1:$RPC_PORT yet, fine if bitcoind is still starting"
fi

# ----------------------------------------------------------------- 4. Secrets
title "Secrets"
install -d -m 0750 "$DEPLOY/secrets"
umask 077
printf '%s\n' "$RPC_PASSWORD" > "$DEPLOY/secrets/rpc_password"
if [[ ! -s "$DEPLOY/secrets/session_key" ]]; then
  openssl rand -hex 32 > "$DEPLOY/secrets/session_key"
  ok "session key generated"
fi
if [[ ! -s "$DEPLOY/secrets/admin_password_hash" ]]; then
  if [[ -t 0 ]]; then
    while true; do
      read -r -s -p "  Admin password for the control panel (min. 8 characters): " P1; echo
      read -r -s -p "  Once more: " P2; echo
      [[ "$P1" == "$P2" && ${#P1} -ge 8 ]] && break
      echo "  Not the same, or too short."
    done
    # The hash is computed by the api image itself: bcryptjs is there, on
    # the host it is not. Plain docker, not compose: .env does not exist yet.
    if [[ $BUILD_LOCAL -eq 1 ]]; then
      note "building the api image to hash the password (first build takes a while on a Pi)"
      docker build --progress=plain -f "$DEPLOY/Dockerfile.api" -t btcnode-api "$REPO"
      HASH_IMAGE="btcnode-api"
    else
      note "fetching the signed api image to hash the password"
      HASH_IMAGE="$(deploy_pull --pull-only | sed -n 's/^API_IMAGE=//p')"
      [[ -n "$HASH_IMAGE" ]] || fail "no verified api image, see above or run with --build"
    fi
    printf '%s' "$P1" | docker run --rm -i "$HASH_IMAGE" node -e '
      const bcrypt = require("bcryptjs"); let d = "";
      process.stdin.on("data", (c) => (d += c)).on("end", () => process.stdout.write(bcrypt.hashSync(d, 12) + "\n"));' \
      > "$DEPLOY/secrets/admin_password_hash"
    ok "admin password stored as bcrypt hash"
  else
    note "no terminal: skipping the admin password. The control panel stays off until deploy/secrets/admin_password_hash exists"
  fi
fi
umask 022
# Owned by root, readable by the api container's user (uid 1000, node) and nobody else.
chown root:1000 "$DEPLOY/secrets" "$DEPLOY/secrets/"*
chmod 0750 "$DEPLOY/secrets"; chmod 0640 "$DEPLOY/secrets/"*
ok "secrets in $DEPLOY/secrets (root-owned, readable by the container user)"

# -------------------------------------------------------------------- 5. TLS
title "TLS certificate"
install -d -m 0755 "$DEPLOY/certs"
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [[ ! -s "$DEPLOY/certs/btcnode.crt" ]]; then
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 3650 \
    -subj "/CN=$(hostname)" -addext "subjectAltName=DNS:$(hostname),DNS:$(hostname).local${LAN_IP:+,IP:$LAN_IP}" \
    -keyout "$DEPLOY/certs/btcnode.key" -out "$DEPLOY/certs/btcnode.crt" 2>/dev/null
  chmod 0644 "$DEPLOY/certs/btcnode.crt"; chmod 0640 "$DEPLOY/certs/btcnode.key"
  ok "self-signed certificate for $(hostname) / $LAN_IP, valid ten years"
else
  ok "certificate present"
fi
# nginx in the container runs as root for the bind, then drops to nginx — the key must be readable there.
chmod 0644 "$DEPLOY/certs/btcnode.key"

# ------------------------------------------------------------------- 6. .env
title "Configuration"
# Persistent journal only if the directory actually holds files: on Raspberry
# Pi OS /var/log/journal exists but is empty and journald writes to /run.
JOURNAL_DIR="/run/log/journal"
[[ -n "$(ls -A /var/log/journal 2>/dev/null)" ]] && JOURNAL_DIR="/var/log/journal"
JOURNAL_GID="$(getent group systemd-journal | cut -d: -f3)"
AGENT_GID="$(getent group btcnode | cut -d: -f3)"
[[ -n "$JOURNAL_GID" ]] || fail "group systemd-journal not found"
ELECTRUM_PORT=50001
[[ -f /etc/node-dashboard.conf ]] && ELECTRUM_PORT="$(sed -n 's/^ELECTRS_PORT=//p' /etc/node-dashboard.conf | tr -d "'\"")" && ELECTRUM_PORT="${ELECTRUM_PORT:-50001}"
# A bitcoind in a container has no journal entry; its debug.log is the log
# source, and the api container needs the group that may read it.
LOG_SOURCE="journal"
DATA_GID=""
if [[ -n "$BITCOIND_CONTAINER" || $NODE_UNMANAGED -eq 1 ]]; then
  LOG_SOURCE="file"
  DEBUG_LOG="$DATADIR/debug.log"
  if [[ -f "$DEBUG_LOG" ]]; then
    DATA_GID="$(stat -c %g "$DEBUG_LOG")"
    if [[ "$(stat -c %a "$DEBUG_LOG")" =~ ^[0-9][0-3] ]]; then
      # the group may not read it: 0600 and the like
      note "$DEBUG_LOG is not group-readable. The log stays empty until: sudo chmod g+r $DEBUG_LOG (and g+x on $DATADIR)"
    fi
  else
    note "$DEBUG_LOG not found. The log panel stays empty until bitcoind writes it"
  fi
fi
if [[ ! -f "$DEPLOY/.env" ]]; then
  sed -e "s|^HOSTNAME=.*|HOSTNAME=$(hostname)|" \
      -e "s|^WEB_PORT=.*|WEB_PORT=$WEB_PORT|" \
      -e "s|^HTTP_PORT=.*|HTTP_PORT=$HTTP_PORT|" \
      -e "s|^BITCOIN_DATA_DIR=.*|BITCOIN_DATA_DIR=$DATADIR|" \
      -e "s|^ELECTRUM_PORT=.*|ELECTRUM_PORT=$ELECTRUM_PORT|" \
      -e "s|^JOURNAL_DIR=.*|JOURNAL_DIR=$JOURNAL_DIR|" \
      -e "s|^JOURNAL_GID=.*|JOURNAL_GID=$JOURNAL_GID|" \
      -e "s|^AGENT_GID=.*|AGENT_GID=$AGENT_GID|" \
      -e "s|^LOG_SOURCE=.*|LOG_SOURCE=$LOG_SOURCE|" \
      -e "s|^DATA_GID=.*|DATA_GID=$DATA_GID|" \
      "$DEPLOY/.env.example" > "$DEPLOY/.env"
  ok ".env written"
else
  # keep the user's choices, refresh what the machine dictates
  sed -i -e "s|^JOURNAL_DIR=.*|JOURNAL_DIR=$JOURNAL_DIR|" -e "s|^JOURNAL_GID=.*|JOURNAL_GID=$JOURNAL_GID|" -e "s|^AGENT_GID=.*|AGENT_GID=$AGENT_GID|" "$DEPLOY/.env"
  grep -q '^LOG_SOURCE=' "$DEPLOY/.env" || printf 'LOG_SOURCE=%s\n' "$LOG_SOURCE" >> "$DEPLOY/.env"
  grep -q '^DATA_GID=' "$DEPLOY/.env" || printf 'DATA_GID=%s\n' "$DATA_GID" >> "$DEPLOY/.env"
  WEB_PORT="$(sed -n 's/^WEB_PORT=//p' "$DEPLOY/.env")"
  HTTP_PORT="$(sed -n 's/^HTTP_PORT=//p' "$DEPLOY/.env")"
  ok ".env kept (web port $WEB_PORT, http port $HTTP_PORT)"
fi
[[ -d /etc/electrs ]] || { install -d -m 0755 /etc/electrs; note "/etc/electrs created (empty) so the container can mount it"; }
ok "journal: $JOURNAL_DIR (gid $JOURNAL_GID), agent gid $AGENT_GID, log source: $LOG_SOURCE${DATA_GID:+ (data gid $DATA_GID)}"

# --------------------------------------------------------------- 7. Firewall
title "Firewall"
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
  [[ -n "$LAN" ]] || LAN="$(ip -4 route show default | awk '{print $3}' | head -1 | awk -F. '{print $1"."$2".0.0/16"}')"
  for port in "$WEB_PORT" "$HTTP_PORT"; do
    # Our own rules are recognised by their comment, anchored at the line end —
    # a bare "80/tcp" would also match 8080/tcp.
    if ! ufw status | grep -qE "^${port}/tcp .* btcnode-web$"; then
      ufw allow from "$LAN" to any port "$port" proto tcp comment btcnode-web >/dev/null
      ok "ufw: port $port open for $LAN"
    else
      ok "ufw rule for $port present"
    fi
  done
else
  note "ufw not active, nothing to do. Make sure port $WEB_PORT is reachable only from your network"
fi

# ---------------------------------------------------------------- 8. Start
title "Containers"
if [[ $BUILD_LOCAL -eq 1 ]]; then
  # local names in .env, so plain `docker compose` keeps using these builds
  for kv in API_IMAGE=btcnode-api WEB_IMAGE=btcnode-web; do
    if grep -q "^${kv%%=*}=" "$DEPLOY/.env"; then sed -i "s|^${kv%%=*}=.*|$kv|" "$DEPLOY/.env"; else echo "$kv" >> "$DEPLOY/.env"; fi
  done
  cd "$DEPLOY"
  docker compose -f docker-compose.yml -f docker-compose.build.yml build --progress=plain
  docker compose up -d
  for _ in $(seq 1 30); do
    if curl -sk "https://127.0.0.1:${WEB_PORT}/api/health" | grep -q '"ok":true'; then break; fi
    sleep 2
  done
  curl -sk "https://127.0.0.1:${WEB_PORT}/api/health" | grep -q '"ok":true' || fail "the page does not answer, see: docker compose -f $DEPLOY/docker-compose.yml logs"
  ok "api answers through nginx (images built from this checkout)"
else
  # verifies the signatures, writes the digests into .env, starts, checks the page
  deploy_pull
fi

title "Done"
echo
echo "  Dashboard:  https://${LAN_IP:-$(hostname)}$([[ "$WEB_PORT" == 443 ]] || echo ":$WEB_PORT")/"
echo "  The certificate is self-signed. Accept the browser's warning once."
echo "  Logs:       docker compose -f $DEPLOY/docker-compose.yml logs -f"
echo
