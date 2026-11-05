#!/usr/bin/env bash
#
# 55-i2p.sh — add I2P as a second anonymous network next to Tor.
#
# RUN THIS AFTER 50-tor.sh.
# I2P is a second overlay network with the same property as Tor: other nodes
# reach you through an address that says nothing about where you are. With
# both networks the node has more peers, does not hang on Tor alone, and
# still never shows its home IP to anybody — that is the point of adding
# I2P instead of clearnet.
#
# What changes:
#   - i2pd (the I2P router) is installed and its SAM interface enabled on
#     127.0.0.1:7656. Nothing else of i2pd listens beyond this machine;
#     the two proxies it ships with are switched off.
#   - Bitcoin Core gets i2psam= and, if it already restricts itself with
#     onlynet=, a second onlynet=i2p. Core creates an I2P address of its own
#     and accepts inbound connections through it.
#   - No firewall change. I2P needs no open port for this; behind CGNAT or
#     DS-Lite it works the same as Tor.
#
# Usage:  sudo bash 55-i2p.sh
#
# Options:
#   --revert   remove the I2P section again and stop i2pd
#   --yes      no questions

set -euo pipefail

REVERT=0
BITCOIN_USER="bitcoin"
ASSUME_YES=0
I2PD_CONF="/etc/i2pd/i2pd.conf"
SAM="127.0.0.1:7656"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
title()  { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
ok()     { printf '  [ ok ] %s\n' "$*"; }
info()   { printf '  ...... %s\n' "$*"; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --revert)  REVERT=1; shift ;;
        --yes)     ASSUME_YES=1; shift ;;
        -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
        *) red "Unknown option: $1"; exit 1 ;;
    esac
done

[[ $EUID -eq 0 ]] || { red "Please run with sudo."; exit 1; }

DATADIR="$(awk -F'-datadir=' '/ExecStart/ {split($2,a," "); print a[1]}' \
    /etc/systemd/system/bitcoind.service 2>/dev/null || true)"
[[ -n "$DATADIR" ]] || DATADIR="/mnt/bitcoin/bitcoin"
CONF="${DATADIR}/bitcoin.conf"
[[ -f "$CONF" ]] || { red "  $CONF not found."; exit 1; }

# Same rule as in 50-tor.sh: ask the node as its own user, with the data
# directory, and keep stderr — a swallowed error message costs an evening.
CLI_ERR="$(mktemp)"
trap 'rm -f "$CLI_ERR"' EXIT
bcli() { sudo -u "$BITCOIN_USER" bitcoin-cli -datadir="$DATADIR" "$@" 2>"$CLI_ERR"; }

backup() {
    cp "$CONF" "${CONF}.before-i2p.$(date +%Y%m%d-%H%M%S)"
    ok "backup of bitcoin.conf created"
}

# ==================================================================== Revert =
if (( REVERT == 1 )); then
    title "Removing I2P"
    backup
    sed -i '/^# --- I2P ---/,/^# --- I2P end ---/d' "$CONF"
    sed -i -e :a -e '/^\n*$/{$d;N;};/\n$/ba' "$CONF"
    systemctl disable --now i2pd >/dev/null 2>&1 || true
    systemctl restart bitcoind
    ok "I2P section removed, i2pd stopped, node restarted"
    echo "  The package stays installed: sudo apt-get remove i2pd"
    exit 0
fi

# ============================================================= Preconditions =
title "Preconditions"

systemctl is-active --quiet bitcoind || { red "  Bitcoin Core is not running."; exit 1; }
ok "Bitcoin Core is running"

NET="$(bcli getnetworkinfo || true)"
if [[ -z "$NET" ]]; then
    red "  bitcoin-cli does not answer:"
    sed 's/^/    /' "$CLI_ERR"
    exit 1
fi

# Core speaks I2P since 22.0; older versions ignore i2psam= and the section
# below would be silent decoration.
VERSION="$(python3 -c "import json,sys; print(json.load(sys.stdin)['version'])" <<<"$NET")"
if (( VERSION < 220000 )); then
    red "  Bitcoin Core $VERSION is too old for I2P (needs 22.0 or newer)."
    exit 1
fi
ok "Bitcoin Core supports I2P"

if grep -q '^onlynet=' "$CONF"; then
    ok "onlynet= is set. I2P will be added to it, clearnet stays off"
    RESTRICTED=1
else
    yellow "  bitcoin.conf has no onlynet= line. The node currently talks in"
    yellow "  the clear as well; this script adds I2P but does not change that."
    yellow "  Run 50-tor.sh first if your home IP is supposed to stay hidden."
    RESTRICTED=0
    if (( ASSUME_YES == 0 )) && [[ -t 0 ]]; then
        read -r -p "  Continue anyway? [y/N] " A
        [[ "${A,,}" == "y" ]] || { echo "  Aborted."; exit 0; }
    fi
fi

# ====================================================================== i2pd =
title "Setting up i2pd"

export DEBIAN_FRONTEND=noninteractive
if ! command -v i2pd >/dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y -qq i2pd >/dev/null
fi
ok "i2pd installed: $(i2pd --version 2>/dev/null | head -1 || echo '?')"
[[ -f "$I2PD_CONF" ]] || { red "  $I2PD_CONF not found. The package looks different from Debian's."; exit 1; }

# i2pd.conf is an INI file. Sections are edited in place — appending a second
# [sam] would make i2pd refuse the file — and every run leaves the same
# result. SAM on: that is how Core talks to the router. The HTTP and SOCKS
# proxies off: nothing here browses I2P, and each is one listener fewer.
cp -n "$I2PD_CONF" "${I2PD_CONF}.before-btcnode"
python3 - "$I2PD_CONF" <<'PY'
import re, sys
path = sys.argv[1]
want = {
    'sam':        {'enabled': 'true', 'address': '127.0.0.1', 'port': '7656'},
    'httpproxy':  {'enabled': 'false'},
    'socksproxy': {'enabled': 'false'},
}
lines = open(path).read().splitlines()
out, section, seen = [], None, {s: set() for s in want}

def flush(sec):
    # keys the section did not contain get appended at its end
    if sec in want:
        for k, v in want[sec].items():
            if k not in seen[sec]:
                out.append(f'{k} = {v}')
                seen[sec].add(k)

for line in lines:
    m = re.match(r'^\s*\[(\w+)\]\s*$', line)
    if m:
        flush(section)
        section = m.group(1)
        out.append(line)
        continue
    if section in want:
        km = re.match(r'^\s*#?\s*(\w+)\s*=', line)
        if km and km.group(1) in want[section]:
            key = km.group(1)
            if key in seen[section]:
                continue          # a duplicate would trip the parser
            out.append(f'{key} = {want[section][key]}')
            seen[section].add(key)
            continue
    out.append(line)
flush(section)
for sec in want:
    if not seen[sec]:
        out += ['', f'[{sec}]']
        section = sec
        flush(sec)
open(path, 'w').write('\n'.join(out) + '\n')
PY
ok "SAM enabled on $SAM, HTTP and SOCKS proxies off"

systemctl enable i2pd >/dev/null 2>&1 || true
systemctl restart i2pd
sleep 5
if ss -ltn 2>/dev/null | grep -q "$SAM"; then
    ok "i2pd is listening on $SAM"
else
    red "  i2pd does not listen on $SAM. Stopping here; bitcoin.conf is untouched."
    systemctl status i2pd --no-pager -n 15 | sed 's/^/    /'
    exit 1
fi

# ============================================================ Configuration ==
title "Telling Bitcoin Core about I2P"
backup
sed -i '/^# --- I2P ---/,/^# --- I2P end ---/d' "$CONF"
{
    echo
    echo "# --- I2P ---"
    echo "# Second anonymous network next to Tor. Core creates an I2P address of"
    echo "# its own through i2pd's SAM interface and accepts inbound peers there."
    echo "i2psam=$SAM"
    echo "i2pacceptincoming=1"
    if (( RESTRICTED == 1 )); then
        echo "# onlynet= lines add up: onion (from the Tor section) plus i2p."
        echo "onlynet=i2p"
    fi
    echo "# --- I2P end ---"
} >> "$CONF"
ok "I2P section written into bitcoin.conf"

# ================================================================= Restart ===
title "Restarting"
info "stopping the node (this can take a few minutes) ..."
systemctl restart bitcoind

# I2P is slow to start: i2pd first has to build tunnels, Core then has to
# find I2P peers through them. A few minutes without a peer are normal here
# and not a reason to fail — Tor keeps the node connected meanwhile.
info "waiting for the first I2P connection (up to 6 min; Tor keeps working meanwhile) ..."
I2P_COUNT=0
for I in $(seq 1 36); do
    sleep 10
    I2P_COUNT="$(bcli getpeerinfo 2>/dev/null \
        | python3 -c "import json,sys; print(sum(1 for p in json.load(sys.stdin) if p.get('network') == 'i2p'))" 2>/dev/null || echo 0)"
    if (( I2P_COUNT >= 1 )); then
        printf '\r\033[K'
        ok "${I2P_COUNT} I2P connection(s) established"
        break
    fi
    printf '  ...... %s of 360 s\r' "$((I * 10))"
done
echo

# ==================================================================== Result =
title "Done"

NET="$(bcli getnetworkinfo || true)"
I2P_ADDR="$(python3 -c "
import json,sys
d = json.load(sys.stdin)
for a in d.get('localaddresses', []):
    if a['address'].endswith('.i2p'):
        print(f\"{a['address']}:{a['port']}\")
" <<<"$NET" 2>/dev/null || true)"
REACHABLE="$(python3 -c "
import json,sys
d = json.load(sys.stdin)
print(next((str(n['reachable']).lower() for n in d.get('networks', []) if n['name'] == 'i2p'), 'unknown'))
" <<<"$NET" 2>/dev/null || echo unknown)"

if [[ "$REACHABLE" == "true" ]]; then
    green "Your node speaks I2P now, next to Tor."
else
    yellow "Core does not report I2P as reachable yet. Give i2pd a few minutes,"
    yellow "then check:  bitcoin-cli getnetworkinfo | jq '.networks'"
fi
echo
if [[ -n "$I2P_ADDR" ]]; then
    echo "  Your I2P address:"
    echo "      $I2P_ADDR"
else
    echo "  The I2P address appears in a few minutes under:"
    echo "      bitcoin-cli getnetworkinfo | jq -r '.localaddresses'"
fi
echo
echo "  Peers per network:"
echo "      bitcoin-cli getpeerinfo | jq -r '.[].network' | sort | uniq -c"
if (( RESTRICTED == 1 )); then
    echo "  Only 'onion' and 'i2p' should appear there."
fi
echo
if (( I2P_COUNT < 1 )); then
    yellow "  No I2P peer yet. That is common in the first quarter of an hour;"
    yellow "  i2pd is still building tunnels. If nothing shows up after an hour:"
    yellow "      journalctl -u i2pd -n 30"
    echo
fi
echo "  i2pd keeps about 100 MB of memory and a little CPU. Watch the"
echo "  dashboard's system card for a while after this."
echo
echo "  To undo:  sudo bash 55-i2p.sh --revert"
echo
