#!/usr/bin/env bash
#
# 60-tor-automatic.sh — have the node switch itself to Tor once it is synced.
#
# Optional. Everything this arranges you can do yourself by running 50-tor.sh
# when you see that the chain is up to date. The point of it is the moment:
# the initial sync finishes when it finishes, often in the middle of the
# night, and until you switch, every peer still sees your home address.
#
# The watchdog checks every ten minutes whether the chain is up to date. Once
# it has been for a full hour without interruption, it runs 50-tor.sh once and
# switches itself off.
#
# Usage:
#   sudo bash 60-tor-automatic.sh            set it up
#   sudo bash 60-tor-automatic.sh --status   what it currently thinks
#   sudo bash 60-tor-automatic.sh --off      switch it off, change nothing
#
# Repeatable: running it twice changes nothing.
#
# Read this before you use it: the watchdog runs as root, without the
# sandboxing the other services get, and it edits the node's configuration
# while nobody is watching. It needs those rights — 50-tor.sh installs a
# package, writes to /etc and changes the firewall. If that trade is not one
# you want to make, skip this script and run 50-tor.sh by hand. Nothing else
# in this project depends on it.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="/usr/local/lib/btcnode"
STATE_DIR="/var/lib/tor-after-sync"
DONE="${STATE_DIR}/done"
HITS="${STATE_DIR}/hits"
UNIT="tor-after-sync"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
title()  { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
ok()     { printf '  [ ok ] %s\n' "$*"; }
info()   { printf '  ...... %s\n' "$*"; }
warn()   { printf '  [ !! ] %s\n' "$*"; }

ACTION="setup"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --status)  ACTION="status"; shift ;;
        --off)     ACTION="off"; shift ;;
        -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
        *) red "Unknown option: $1"; exit 1 ;;
    esac
done

[[ $EUID -eq 0 ]] || { red "Please run with sudo."; exit 1; }

# ==================================================================== Status =
if [[ "$ACTION" == "status" ]]; then
    title "Automatic Tor switch"
    if systemctl is-enabled --quiet "${UNIT}.timer" 2>/dev/null; then
        ok "timer is active"
    else
        warn "timer is not active"
    fi
    if [[ -f "$DONE" ]]; then
        ok "already switched on $(cat "$DONE")"
    else
        HAD="$(cat "$HITS" 2>/dev/null || echo 0)"
        info "readings so far: ${HAD} of 6 (one hour)"
    fi
    echo
    info "next run:"
    systemctl list-timers "${UNIT}.timer" --no-pager 2>/dev/null \
        | sed -n '2p' | sed 's/^/    /'
    info "log:  journalctl -u ${UNIT} -n 50"
    exit 0
fi

# ===================================================================== Off ===
if [[ "$ACTION" == "off" ]]; then
    title "Switching the automation off"
    systemctl disable --now "${UNIT}.timer" >/dev/null 2>&1 || true
    ok "timer off. Nothing will be changed automatically."
    info "To switch by hand:  sudo bash 50-tor.sh"
    exit 0
fi

# =================================================================== Setup ===
title "Preconditions"

WATCHDOG="${HERE}/tor-after-sync.sh"
TORSCRIPT="${HERE}/50-tor.sh"
[[ -f "$WATCHDOG" ]]  || { red "  tor-after-sync.sh is missing next to this script."; exit 1; }
[[ -f "$TORSCRIPT" ]] || { red "  50-tor.sh is missing next to this script."; exit 1; }
ok "both programs are here"

systemctl is-active --quiet bitcoind || {
    red "  Bitcoin Core is not running. Run 30-bitcoin-core.sh first."
    exit 1; }
ok "Bitcoin Core is running"

if [[ -f "$DONE" ]]; then
    warn "The switch was already triggered ($(cat "$DONE"))."
    warn "To arm it again: sudo rm ${DONE}"
fi

title "Installing"

# The watchdog runs 50-tor.sh from a fixed path. Copying it there means the
# automation keeps working after you delete the checkout it came from.
install -d -m 0755 "$LIB"
install -m 0755 -o root -g root "$TORSCRIPT" "${LIB}/50-tor.sh"
install -m 0755 -o root -g root "$WATCHDOG"  "${LIB}/tor-after-sync.sh"
install -d -m 0755 "$STATE_DIR"
ok "watchdog in ${LIB}/tor-after-sync.sh"
ok "switch script in ${LIB}/50-tor.sh"

# Deliberately as root and without the usual sandboxing: this service has to
# install a package, write systemd units and change the firewall. That is why
# it runs for a few seconds every ten minutes and switches itself off once the
# work is done, rather than sitting around as a daemon.
cat > "/etc/systemd/system/${UNIT}.service" <<EOF
[Unit]
Description=Switch the node to Tor once the initial sync has finished
After=network-online.target bitcoind.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=${LIB}/tor-after-sync.sh
# No ProtectSystem: 50-tor.sh installs a package and writes to /etc.
PrivateTmp=true
NoNewPrivileges=false
# The switch restarts bitcoind and then waits up to four minutes for peers
# over Tor. Stopping it half way through would be worse than waiting.
TimeoutStartSec=3600
EOF

cat > "/etc/systemd/system/${UNIT}.timer" <<EOF
[Unit]
Description=Check every ten minutes whether the chain is up to date

[Timer]
OnBootSec=15min
OnUnitActiveSec=10min
AccuracySec=1min
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now "${UNIT}.timer" >/dev/null
ok "timer running, checks every 10 minutes"

# Run once straight away so there is something in the log to look at.
systemctl start "${UNIT}.service" || true
sleep 2

title "Done"
echo "  The watchdog is armed."
echo
echo "  Condition   chain up to date for one hour (6 readings)"
echo "  Then        50-tor.sh: Tor, onion service, port 8333 closed,"
echo "              bitcoind restarted"
echo "  Afterwards  the timer switches itself off"
echo
echo "  Status:     sudo bash 60-tor-automatic.sh --status"
echo "  Off:        sudo bash 60-tor-automatic.sh --off"
echo "  Log:        journalctl -u ${UNIT} -n 50"
echo
warn "The switch closes port 8333 and restarts bitcoind."
warn "If you want to watch it happen, switch the timer off and do it by hand."
