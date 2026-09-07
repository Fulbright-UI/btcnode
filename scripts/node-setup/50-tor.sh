#!/usr/bin/env bash
#
# 50-tor.sh — move Bitcoin Core onto Tor.
#
# RUN THIS ONLY AFTER THE INITIAL SYNC HAS FINISHED.
# Over Tor the node downloads noticeably slower. While fetching public block
# data you are not giving away anything worth protecting — it gets sensitive
# only when you broadcast your own transactions. So: finish syncing first,
# then switch.
#
# What changes:
#   - outbound the node speaks only over Tor. No peer sees your home IP
#     any more.
#   - the node gets an onion address of its own and becomes reachable from
#     outside — even behind CGNAT or DS-Lite, where inbound IPv4 is
#     impossible.
#   - port 8333 is closed in the firewall; it is no longer needed.
#   - the read-only methods the dashboard needs are added to its whitelist.
#
# Usage:  sudo bash 50-tor.sh
#
# Options:
#   --also-clearnet   Tor in addition rather than exclusively (less private)
#   --revert          undo the switch
#   --yes             no questions

set -euo pipefail

ONLY_TOR=1
REVERT=0
BITCOIN_USER="bitcoin"
ASSUME_YES=0

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
title()  { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
ok()     { printf '  [ ok ] %s\n' "$*"; }
info()   { printf '  ...... %s\n' "$*"; }
warn()   { printf '  [ !! ] %s\n' "$*"; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --also-clearnet) ONLY_TOR=0; shift ;;
        --revert)        REVERT=1; shift ;;
        --yes)           ASSUME_YES=1; shift ;;
        -h|--help)       sed -n '2,26p' "$0"; exit 0 ;;
        *) red "Unknown option: $1"; exit 1 ;;
    esac
done

[[ $EUID -eq 0 ]] || { red "Please run with sudo."; exit 1; }

DATADIR="$(awk -F'-datadir=' '/ExecStart/ {split($2,a," "); print a[1]}' \
    /etc/systemd/system/bitcoind.service 2>/dev/null || true)"
[[ -n "$DATADIR" ]] || DATADIR="/mnt/bitcoin/bitcoin"
CONF="${DATADIR}/bitcoin.conf"
[[ -f "$CONF" ]] || { red "  $CONF not found."; exit 1; }

# Always ask the node as its own user and with an explicit data directory —
# that is where bitcoind writes the auth cookie.
#
# This used to run as 'sudo -u "${SUDO_USER:-root}"'. That works when a human
# runs the script, but not when it is invoked from a systemd unit: there is no
# SUDO_USER there, so it falls back to root, and root has no
# ~/.bitcoin/bitcoin.conf — the credentials are only written for the admin
# user. The single "bitcoin-cli does not answer" gave no clue, because stderr
# was discarded. It is kept and printed now.
CLI_ERR="$(mktemp)"
trap 'rm -f "$CLI_ERR"' EXIT
bcli() { sudo -u "$BITCOIN_USER" bitcoin-cli -datadir="$DATADIR" "$@" 2>"$CLI_ERR"; }

backup() {
    cp "$CONF" "${CONF}.before-tor.$(date +%Y%m%d-%H%M%S)"
    ok "backup of bitcoin.conf created"
}

# ==================================================================== Revert =
if (( REVERT == 1 )); then
    title "Undoing the switch"
    backup
    sed -i '/^# --- Tor ---/,/^# --- Tor end ---/d' "$CONF"
    # Tidy up trailing blank lines so repeated runs do not slowly fill the
    # file with empty paragraphs
    sed -i -e :a -e '/^\n*$/{$d;N;};/\n$/ba' "$CONF"
    ufw allow 8333/tcp comment 'Bitcoin P2P' >/dev/null 2>&1 || true
    systemctl restart bitcoind
    ok "Tor section removed, port 8333 open again, node restarted"
    exit 0
fi

# ============================================================= Preconditions =
title "Preconditions"

systemctl is-active --quiet bitcoind || { red "  Bitcoin Core is not running."; exit 1; }
ok "Bitcoin Core is running"

CHAIN="$(bcli getblockchaininfo || true)"
if [[ -z "$CHAIN" ]]; then
    red "  bitcoin-cli does not answer:"
    sed 's/^/    /' "$CLI_ERR"
    exit 1
fi

PROGRESS="$(python3 -c "import json,sys; print(json.load(sys.stdin)['verificationprogress'])" <<<"$CHAIN")"
PERCENT="$(python3 -c 'import sys; print(f"{float(sys.argv[1])*100:.2f}")' "$PROGRESS")"

if python3 -c 'import sys; sys.exit(0 if float(sys.argv[1]) > 0.9999 else 1)' "$PROGRESS"; then
    ok "blockchain in sync (${PERCENT} %)"
else
    echo
    red "  The node is only ${PERCENT} % synced."
    red "  Over Tor the rest would take several times as long."
    echo
    if (( ASSUME_YES == 0 )) && [[ -t 0 ]]; then
        read -r -p "  Really switch now? [y/N] " A
        [[ "${A,,}" == "y" ]] || { echo "  Aborted. Come back when it is done."; exit 0; }
    else
        echo "  Aborted (no confirmation possible). Use --yes to force."
        exit 0
    fi
fi

# ======================================================================= Tor =
title "Setting up Tor"

export DEBIAN_FRONTEND=noninteractive
if ! command -v tor >/dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y -qq tor >/dev/null
fi
ok "Tor installed: $(tor --version 2>/dev/null | head -1)"

# Bitcoin Core creates its own onion service over Tor's control channel. That
# is cleaner than a fixed directory in torrc: the key then belongs to bitcoind
# and disappears with it when the switch is reverted.
if ! grep -q '^ControlPort 9051' /etc/tor/torrc 2>/dev/null; then
    cat >> /etc/tor/torrc <<'EOF'

# Control channel so Bitcoin Core can create an onion service of its own
ControlPort 9051
CookieAuthentication 1
CookieAuthFileGroupReadable 1
EOF
    ok "control channel added to /etc/tor/torrc"
else
    ok "control channel already set up"
fi

usermod -aG debian-tor "$BITCOIN_USER"
ok "user '$BITCOIN_USER' may use the control channel"

systemctl enable tor >/dev/null 2>&1 || true
systemctl restart tor
sleep 6

if ss -ltn 2>/dev/null | grep -q '127.0.0.1:9050'; then
    ok "Tor is listening on 127.0.0.1:9050"
else
    red "  Tor is not running as expected. Stopping here so your node stays"
    red "  reachable."
    systemctl status tor --no-pager -n 15 | sed 's/^/    /'
    exit 1
fi

# ============================================================ Configuration ==
title "Switching Bitcoin Core over"
backup

# Remove an old Tor section so the script stays repeatable
sed -i '/^# --- Tor ---/,/^# --- Tor end ---/d' "$CONF"

{
    echo
    echo "# --- Tor ---"
    echo "# Outbound connections go through the Tor proxy."
    echo "proxy=127.0.0.1:9050"
    echo "# An onion service of our own: makes the node reachable from outside"
    echo "# even where inbound IPv4 is impossible (CGNAT, DS-Lite)."
    echo "listen=1"
    echo "listenonion=1"
    echo "torcontrol=127.0.0.1:9051"
    if (( ONLY_TOR == 1 )); then
        echo "# Onion peers exclusively. No connection leaves this machine in"
        echo "# the clear any more, and your home IP appears nowhere."
        echo "onlynet=onion"
        echo "# Bind locally only — reachability comes through Tor."
        echo "bind=127.0.0.1"
    fi
    echo "# --- Tor end ---"
} >> "$CONF"
ok "Tor section written into bitcoin.conf"

# --- unlock the read-only methods the dashboard needs -----------------------
# All of them are read-only: they return statistics and block headers and
# nothing else. Anyone adding to this list must check that first.
for METHOD in estimatesmartfee getblockstats getnetworkhashps getpeerinfo; do
    if grep -q '^rpcwhitelist=dashboard:' "$CONF" && ! grep -q "$METHOD" "$CONF"; then
        sed -i "s/^\(rpcwhitelist=dashboard:.*\)$/\1,${METHOD}/" "$CONF"
        ok "'${METHOD}' added to the dashboard whitelist"
    fi
done

# ================================================================== Firewall =
title "Firewall"
# Close every rule for 8333/tcp, whoever wrote it — so by port, but anchored
# to the column: a bare grep '8333/tcp' also matched 18333/tcp (2026-09-06).
# --force instead of "yes |": under pipefail, "|| break" otherwise left the
# loop after the first of two rules (v4 deleted, v6 kept).
while :; do
    NR="$(ufw status numbered 2>/dev/null | grep -E '^\[[ 0-9]+\] 8333/tcp([[:space:]]|$)' \
          | head -1 | tr -d '[]' | awk '{print $1}')"
    [[ "$NR" =~ ^[0-9]+$ ]] || break
    ufw --force delete "$NR" >/dev/null 2>&1 || break
done
ok "port 8333 closed — inbound now runs entirely over Tor"

# ================================================================= Restart ===
title "Restarting"
info "stopping the node (this can take a few minutes) ..."
systemctl restart bitcoind

info "waiting for connections over Tor ..."
for I in $(seq 1 24); do
    sleep 10
    COUNT="$(bcli getconnectioncount || echo 0)"
    if (( COUNT >= 3 )); then
        # The progress line ends in \r and overwrites itself. Without \033[K
        # its longer remainder survives and sticks to the shorter success
        # message ("3 connections establishedconnections").
        printf '\r\033[K'
        ok "${COUNT} connections established"
        break
    fi
    printf '  ...... %s of 240 s, %s connections so far\r' "$((I * 10))" "$COUNT"
done
echo

COUNT="$(bcli getconnectioncount || echo 0)"
if (( COUNT < 1 )); then
    echo
    red "  No connection after four minutes. That is a problem."
    red "  Revert with:  sudo bash 50-tor.sh --revert"
    journalctl -u bitcoind -n 25 --no-pager | sed 's/^/    /'
    exit 1
fi

# ==================================================================== Result =
title "Done"

NET="$(bcli getnetworkinfo || true)"
ONION="$(python3 -c "
import json,sys
d = json.load(sys.stdin)
for a in d.get('localaddresses', []):
    if a['address'].endswith('.onion'):
        print(f\"{a['address']}:{a['port']}\")
" <<<"$NET" 2>/dev/null || true)"

green "Your node now speaks over Tor only."
echo
if [[ -n "$ONION" ]]; then
    echo "  Your onion address:"
    echo "      $ONION"
    echo
    echo "  Other nodes reach you through it, whatever your router does."
else
    yellow "  The onion address is not ready yet. In a few minutes:"
    echo "      bitcoin-cli getnetworkinfo | jq -r '.localaddresses'"
fi
echo
echo "  Check that nothing runs in the clear any more:"
echo "      bitcoin-cli getpeerinfo | jq -r '.[].network' | sort | uniq -c"
echo "  Only 'onion' should appear there."
echo
yellow "  Expect fewer connections than before and slightly slower block"
yellow "  propagation. For the security of your node that is irrelevant — it"
yellow "  still verifies every block itself."
echo
echo "  To undo:  sudo bash 50-tor.sh --revert"
echo
