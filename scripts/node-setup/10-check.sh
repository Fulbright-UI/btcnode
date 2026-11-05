#!/usr/bin/env bash
#
# 10-check.sh — take stock. Changes nothing.
#
# Run this first. It answers the questions the other scripts would otherwise
# run into: is the hardware up to it, is the power supply stable, which disks
# are there, is anything already installed.
#
# It writes nothing, installs nothing and needs no sudo — except that a few
# readings (disk models, throttling) are only visible to root.
#
# Usage:  bash 10-check.sh
#         sudo bash 10-check.sh     more detail

set -uo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    sed -n '2,15p' "$0"
    exit 0
fi

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
title()  { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
ok()     { printf '  [ ok ] %s\n' "$*"; }
info()   { printf '  ...... %s\n' "$*"; }
warn()   { printf '  [ !! ] %s\n' "$*"; }

PROBLEMS=0
note_problem() { PROBLEMS=$(( PROBLEMS + 1 )); }

# ==================================================================== System =
title "System"

MODEL=""
[[ -r /proc/device-tree/model ]] && MODEL="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || true)"
[[ -n "$MODEL" ]] && ok "model: $MODEL"
ok "kernel: $(uname -r), architecture: $(uname -m)"

case "$(uname -m)" in
    aarch64|x86_64) ok "64-bit, good" ;;
    *) red "  32-bit system. Bitcoin Core needs 64 bit."; note_problem ;;
esac

if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    ok "distribution: ${PRETTY_NAME:-unknown}"
fi

RAM_MB=$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo) / 1024 ))
CORES="$(nproc)"
if (( RAM_MB >= 3500 )); then
    ok "memory: ${RAM_MB} MB, ${CORES} cores"
else
    warn "only ${RAM_MB} MB of memory. It works, but the initial sync will drag."
fi

# The dbcache the installer would choose, so nobody has to guess later.
# These are Bitcoin Core's own defaults, which depend on memory since v31.
if (( RAM_MB >= 4096 )); then SUGGEST=1024
else                         SUGGEST=450
fi
info "30-bitcoin-core.sh would set dbcache to ${SUGGEST} MB (Core's default)"
info "(deviate in either direction only with a measurement in hand: too high"
info "and the kernel swaps the cache, too low and every input comes off disk)"

# ============================================================= Power supply ==
if command -v vcgencmd >/dev/null 2>&1; then
    title "Power supply"
    W=$(( $(vcgencmd get_throttled 2>/dev/null | cut -d= -f2) ))
    if (( W == 0 )); then
        ok "stable, no undervoltage since boot"
    else
        red "  get_throttled = $(printf '0x%x' "$W")"
        (( W & 0x1 ))     && red "  undervoltage RIGHT NOW"
        (( W & 0x40000 )) && red "  undervoltage since boot"
        (( W & 0x4 ))     && red "  currently throttled"
        red "  This is the most common cause of a corrupted blockchain database."
        red "  Sort the power supply out before you start."
        note_problem
    fi
    TEMP="$(vcgencmd measure_temp 2>/dev/null | tr -dc '0-9.')"
    [[ -n "$TEMP" ]] && info "temperature: ${TEMP} °C"
fi

# =================================================================== Storage =
title "Storage"

echo
lsblk -o NAME,SIZE,TYPE,TRAN,FSTYPE,LABEL,MOUNTPOINT,MODEL 2>/dev/null | sed 's/^/  /'
echo

ROOT_SOURCE="$(findmnt -no SOURCE / 2>/dev/null || true)"
ROOT_DISK="$(lsblk -no PKNAME "$ROOT_SOURCE" 2>/dev/null | head -1 || true)"

# Candidates: whole disks that are not the system disk and carry nothing
# mounted. Every single one of these conditions has to be answerable — if a
# reading fails, the disk is NOT a candidate.
#
# The reason is concrete: in a container without real block devices the root
# detection came back empty and every lsblk on a device failed. This script
# then cheerfully proposed wiping the system disk. A check that suggests
# something destructive when it cannot see is worse than no check.
CANDIDATES=()
if [[ -z "$ROOT_DISK" ]]; then
    warn "could not determine the system disk, no suggestions will be made"
else
    ok "system disk: /dev/${ROOT_DISK} (the scripts never touch it)"
    while read -r NAME TYPE; do
        [[ "$TYPE" == "disk" ]] || continue
        [[ "$NAME" == "$ROOT_DISK" ]] && continue
        [[ -b "/dev/$NAME" ]] || continue
        # A device we cannot read is not a candidate.
        MOUNTS="$(lsblk -lno MOUNTPOINT "/dev/$NAME" 2>/dev/null)" || continue
        [[ -n "$(grep -v '^$' <<<"$MOUNTS")" ]] && continue
        CANDIDATES+=("/dev/$NAME")
    done < <(lsblk -dno NAME,TYPE 2>/dev/null)
fi

if (( ${#CANDIDATES[@]} > 0 )); then
    TOTAL=0
    for D in "${CANDIDATES[@]}"; do
        GB=$(( $(blockdev --getsize64 "$D" 2>/dev/null || echo 0) / 1000000000 ))
        TOTAL=$(( TOTAL + GB ))
        info "free for the chain: $D (${GB} GB)"
    done
    if (( TOTAL >= 900 )); then
        ok "${TOTAL} GB together, enough for the full archive"
    elif (( TOTAL > 0 )); then
        yellow "  ${TOTAL} GB together. The full chain needs about 900 GB."
        yellow "  Below that, 30-bitcoin-core.sh will offer pruning: the node"
        yellow "  still validates every block, it just does not keep the archive."
    fi
else
    warn "no unused disk found. 20-storage.sh needs one."
fi

# ============================================================== Already there =
title "Already installed"

for SVC in bitcoind electrs tor btcnode-agent docker; do
    if systemctl list-unit-files 2>/dev/null | grep -q "^${SVC}\.service"; then
        if systemctl is-active --quiet "$SVC"; then
            ok "$SVC is running"
        else
            info "$SVC installed but not running"
        fi
    fi
done
command -v bitcoind >/dev/null && info "bitcoind: $(bitcoind --version 2>/dev/null | head -1)"
command -v python3  >/dev/null && ok "python3: $(python3 -V 2>&1)"
command -v python3  >/dev/null || { red "  python3 is missing."; note_problem; }

# ================================================================== Network ==
title "Network"

LOCAL_IP="$(ip -4 -o route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')"
[[ -n "$LOCAL_IP" ]] && ok "local address: $LOCAL_IP"

# A node behind CGNAT or DS-Lite cannot be reached over IPv4 from outside, no
# matter what the router is told. That is not a fault — it is what 50-tor.sh
# is for. Better to know now than to spend an evening on port forwarding.
if command -v curl >/dev/null 2>&1; then
    PUBLIC_IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
    if [[ -n "$PUBLIC_IP" && -n "$LOCAL_IP" ]]; then
        info "public address: $PUBLIC_IP"
        if [[ "$PUBLIC_IP" != "$LOCAL_IP" ]]; then
            info "you are behind NAT, normal for a home connection"
            info "if inbound IPv4 turns out to be impossible (CGNAT, DS-Lite),"
            info "50-tor.sh solves it with an onion service"
        fi
    fi
fi

# ==================================================================== Result =
title "Result"

if (( PROBLEMS == 0 )); then
    green "  Nothing speaks against it."
    echo
    echo "  Next step:"
    if (( ${#CANDIDATES[@]} > 0 )); then
        echo "      sudo bash 20-storage.sh --disks ${CANDIDATES[*]}"
        echo "      (without --wipe that only prints a plan)"
    else
        echo "      sudo bash 30-bitcoin-core.sh --datadir /path/to/data"
    fi
else
    red "  ${PROBLEMS} point(s) need attention before you continue."
fi
echo
