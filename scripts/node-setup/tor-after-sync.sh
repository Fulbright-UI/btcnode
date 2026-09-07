#!/usr/bin/env bash
#
# tor-after-sync.sh — switch the node to Tor once the initial sync is done.
#
# Installed by 60-tor-automatic.sh and run from a systemd timer every ten
# minutes, as root. It asks the node whether the chain is up to date. Once it
# has been for a full hour without interruption, it runs 50-tor.sh exactly
# once and then disables its own timer.
#
# Run 60-tor-automatic.sh to set this up; this script is not meant to be
# called by hand. It prints to the journal, one line per run.
#
# Why an hour and not straight away: 'verificationprogress' brushes against
# one several times shortly before the end, and a single outlier must not
# reconfigure a node. Six readings ten minutes apart are cheap and rule it
# out.
#
# Safeguards, because this changes the node's configuration unattended:
#
#   * It runs exactly once. Afterwards a marker file stands, and the timer is
#     switched off.
#   * The marker is written BEFORE the call. If the machine dies mid-switch,
#     nothing is retried — running over a half-converted configuration a
#     second time makes it worse, not better.
#   * The node is only ever asked, never told: getblockchaininfo, nothing else.
#   * 50-tor.sh backs up the bitcoin.conf itself before it touches it.
#
# Two steps, in this order:
#
#   1. 50-tor.sh — Tor, onion service, port 8333 closed, bitcoind restarted
#   2. electrs, if 40-electrs.sh installed it and left it switched off
#
# electrs comes second because it needs a running node, and the node is only
# back after the restart in step 1. It was left off on purpose: its first
# index pass and the initial sync fight over the same disk and cores.
#
# What it deliberately does NOT do, unlike its counterpart on the author's own
# machine: it does not touch dbcache or maxmempool. 30-bitcoin-core.sh sets
# both to values meant for permanent operation, so there is nothing to take
# back.

set -euo pipefail

# Six readings ten minutes apart — one hour of uninterrupted sync.
NEEDED=6

# Everything this script reads or writes sits below this prefix. It is empty
# in normal operation. The test sets it to a temporary directory, and that is
# what makes it possible to run this very script in the test instead of a copy
# of its logic — the copy is what goes stale and stops catching anything.
# Without a prefix root is required; with one, nothing outside it is reachable
# anyway.
ROOT="${TAS_ROOT:-}"
[[ -n "$ROOT" || $EUID -eq 0 ]] || { echo "must run as root" >&2; exit 1; }

STATE_DIR="${ROOT}/var/lib/tor-after-sync"
DONE="${STATE_DIR}/done"
HITS="${STATE_DIR}/hits"
SCRIPT="${ROOT}/usr/local/lib/btcnode/50-tor.sh"
UNIT_FILE="${ROOT}/etc/systemd/system/bitcoind.service"
TIMER="tor-after-sync.timer"
BITCOIN_USER="bitcoin"

if [[ -f "$DONE" ]]; then
    echo "already switched on $(cat "$DONE") — nothing to do"
    exit 0
fi

DATADIR="$(awk -F'-datadir=' '/ExecStart/ {split($2,a," "); print a[1]}' \
    "$UNIT_FILE" 2>/dev/null || true)"
[[ -n "$DATADIR" ]] || DATADIR="/mnt/bitcoin/bitcoin"
CONF="${DATADIR}/bitcoin.conf"

# Same reasoning as in 50-tor.sh: there is no SUDO_USER inside a systemd unit,
# and root has no ~/.bitcoin/bitcoin.conf. Ask as the node's own user, with an
# explicit data directory, where bitcoind writes its cookie.
CLI_ERR="$(mktemp)"
trap 'rm -f "$CLI_ERR"' EXIT
bcli() { sudo -u "$BITCOIN_USER" bitcoin-cli -datadir="$DATADIR" "$@" 2>"$CLI_ERR"; }

mkdir -p "$STATE_DIR"

# Somebody switched by hand in the meantime. Then there is nothing left to do,
# and saying so is better than waiting forever for a condition that will never
# fire again.
if grep -q '^proxy=127\.0\.0\.1:9050' "$CONF" 2>/dev/null; then
    date -Is > "$DONE"
    systemctl disable --now "$TIMER" >/dev/null 2>&1 || true
    echo "the node already runs over Tor — timer switched off"
    exit 0
fi

systemctl is-active --quiet bitcoind || {
    echo "bitcoind is not running — waiting"
    exit 0; }

# A node that does not answer is not a node that is behind: during the sync
# bitcoind stalls its RPC thread whenever it flushes the dbcache. That is a
# reason to wait, never a reason to reset the counter.
if ! CHAIN="$(bcli getblockchaininfo)" || [[ -z "$CHAIN" ]]; then
    echo "node does not answer: $(tr '\n' ' ' < "$CLI_ERR")"
    exit 0
fi

read -r PROGRESS IBD <<<"$(python3 -c "
import json, sys
d = json.load(sys.stdin)
print(d.get('verificationprogress', 0), int(bool(d.get('initialblockdownload', True))))
" <<<"$CHAIN")"

HAD="$(cat "$HITS" 2>/dev/null || echo 0)"
[[ "$HAD" =~ ^[0-9]+$ ]] || HAD=0

if ! python3 -c "import sys; sys.exit(0 if float('$PROGRESS') >= 0.99999 and $IBD == 0 else 1)"; then
    [[ "$HAD" == "0" ]] || echo 0 > "$HITS"
    printf 'not synced yet (%.3f %%)\n' "$(python3 -c "print(float('$PROGRESS')*100)")"
    exit 0
fi

HAD=$(( HAD + 1 ))
echo "$HAD" > "$HITS"

if (( HAD < NEEDED )); then
    echo "synced, reading ${HAD} of ${NEEDED}"
    exit 0
fi

[[ -x "$SCRIPT" || -f "$SCRIPT" ]] || {
    echo "${SCRIPT} is missing — run 60-tor-automatic.sh again" >&2
    exit 1; }

# Marker first, call second. See the note at the top.
date -Is > "$DONE"
echo "chain has been up for an hour — running 50-tor.sh"

# --yes: nobody is sitting in front of this. Every question in 50-tor.sh is
# guarded by it, and the one that matters (switching while not yet synced) is
# exactly the condition we just spent an hour establishing.
if bash "$SCRIPT" --yes; then
    echo "50-tor.sh succeeded — the node now runs over Tor"

    # Now electrs, and only now: it needs a node that answers, and that is
    # what the restart in 50-tor.sh just gave us. 40-electrs.sh left it
    # installed but switched off if the chain was still coming down.
    for UNIT in electrs electrs-lan; do
        [[ -f "${ROOT}/etc/systemd/system/${UNIT}.service" ]] || continue
        if systemctl is-enabled --quiet "$UNIT" 2>/dev/null; then
            echo "${UNIT} was already switched on — left alone"
            continue
        fi
        if systemctl enable --now "$UNIT" >/dev/null 2>&1; then
            echo "${UNIT} switched on"
        else
            # Not fatal: Tor is up, which was the point. But say it, because
            # a wallet that cannot reach its server is what gets noticed, and
            # the cause is here.
            echo "${UNIT} did not start — look: systemctl status ${UNIT}" >&2
        fi
    done

    # The job is done; another run could only do harm.
    systemctl disable --now "$TIMER" >/dev/null 2>&1 || true
    exit 0
fi

# Loud, and with the way back: this ran unattended, an hour after the event
# that triggered it, and nobody was watching.
{
    echo "50-tor.sh FAILED. The node may be half converted."
    echo "  look:   journalctl -u tor-after-sync -n 50"
    echo "  undo:   sudo bash ${SCRIPT} --revert"
    echo "  retry:  sudo bash ${SCRIPT}"
    echo "It will not be retried automatically."
} >&2
exit 1
