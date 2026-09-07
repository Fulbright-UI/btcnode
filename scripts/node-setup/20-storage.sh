#!/usr/bin/env bash
#
# 20-storage.sh — prepare a disk for the blockchain.
#
# Creates an LVM volume group across one or more disks and mounts it under
# /mnt/bitcoin. LVM even for a single SSD: that way a second one can be added
# later while everything keeps running, without re-downloading the chain.
#
# With several disks they are chained LINEARLY, not striped: same capacity,
# but a failure does not necessarily take everything with it.
#
#   *** THIS SCRIPT ERASES DISKS COMPLETELY AND IRREVERSIBLY. ***
#
# Because of that it does nothing at all by default. Without --wipe it only
# shows what it would do. That is not politeness; it is the difference between
# a wrong device name costing you a re-read and costing you your data.
#
# Usage:
#   sudo bash 20-storage.sh --disks /dev/sdb              dry run, shows a plan
#   sudo bash 20-storage.sh --disks /dev/sdb --wipe       actually do it
#   sudo bash 20-storage.sh --disks /dev/sda /dev/sdb --wipe
#
# Options:
#   --disks DEV...     the disks to use. Whole devices, not partitions
#   --wipe             really erase. Without this: dry run
#   --mountpoint PATH  where to mount, default /mnt/bitcoin
#   --yes              skip the typed confirmation. For scripted installs
#                      only — you lose the last safety net
#
# Repeatable in the sense that the result is always the same. It is NOT
# repeatable in the sense that data survives: every run erases.

set -euo pipefail

MOUNTPOINT="/mnt/bitcoin"
VG="btc"
LV="chain"
DISKS=()
WIPE=0
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
        --disks)
            shift
            while [[ $# -gt 0 && "$1" == /dev/* ]]; do DISKS+=("$1"); shift; done ;;
        --mountpoint) MOUNTPOINT="${2:-}"; shift 2 ;;
        --wipe)       WIPE=1; shift ;;
        --yes)        ASSUME_YES=1; shift ;;
        -h|--help)    sed -n '2,30p' "$0"; exit 0 ;;
        *) red "Unknown option: $1"; exit 1 ;;
    esac
done

[[ $EUID -eq 0 ]] || { red "Please run with sudo."; exit 1; }

if (( ${#DISKS[@]} == 0 )); then
    red "No disks given."
    echo
    echo "Available:"
    lsblk -o NAME,SIZE,TYPE,TRAN,FSTYPE,LABEL,MOUNTPOINT,MODEL
    echo
    echo "Usage:  sudo bash $0 --disks /dev/sda /dev/sdb"
    echo "        (without --wipe this only prints a plan)"
    exit 1
fi

# ================================================================== Refusals =
# Four separate checks. Each one alone has let a disk through at some point in
# somebody's life, which is why all four are here.
title "Safety checks"

ROOT_SOURCE="$(findmnt -no SOURCE / 2>/dev/null || true)"
ROOT_DISK="$(lsblk -no PKNAME "$ROOT_SOURCE" 2>/dev/null | head -1 || true)"
ok "system disk (untouchable): /dev/${ROOT_DISK:-unknown}"

for D in "${DISKS[@]}"; do
    # 1. Is it a block device at all, and a whole disk rather than a partition?
    [[ -b "$D" ]] || { red "  $D is not a block device."; exit 1; }
    TYPE="$(lsblk -dno TYPE "$D" 2>/dev/null || true)"
    if [[ "$TYPE" != "disk" && "$TYPE" != "loop" ]]; then
        red "  $D is a $TYPE, not a whole disk."
        echo "  Give the device itself (/dev/sdb), not a partition (/dev/sdb1)."
        exit 1
    fi

    # 2. Is it the disk the running system boots from?
    if [[ -n "$ROOT_DISK" && "$D" == "/dev/$ROOT_DISK" ]]; then
        red "  $D is the running system disk. Refusing."
        exit 1
    fi

    # 3. Does / or /boot live on it?
    if lsblk -lno MOUNTPOINT "$D" | grep -qE '^(/|/boot|/boot/firmware)$'; then
        red "  $D carries the running system. Refusing."
        exit 1
    fi

    # 4. Is anything on it mounted right now? A mounted filesystem means
    #    somebody is using it — quite possibly with data on it. We do not
    #    unmount other people's filesystems behind their back.
    MOUNTED="$(lsblk -lno MOUNTPOINT "$D" | grep -v '^$' | tr '\n' ' ' || true)"
    if [[ -n "${MOUNTED// /}" ]]; then
        red "  $D has mounted filesystems: $MOUNTED"
        echo "  Unmount them yourself first. This script will not do it for you."
        exit 1
    fi
done
ok "none of the given disks carries the system or is mounted"

# =================================================================== The plan =
title "What would happen"

TOTAL=0
for D in "${DISKS[@]}"; do
    GB=$(( $(blockdev --getsize64 "$D") / 1000000000 ))
    MODEL="$(lsblk -dno MODEL "$D" 2>/dev/null | xargs || true)"
    SERIAL="$(lsblk -dno SERIAL "$D" 2>/dev/null | xargs || true)"
    printf '  ERASE  %-12s %6s GB  %s\n' "$D" "$GB" "${MODEL:-}"
    [[ -n "$SERIAL" ]] && printf '         %-12s serial %s\n' "" "$SERIAL"
    # Show what is on it right now. Anyone about to lose a filesystem should
    # see its label and size before, not after.
    CONTENT="$(lsblk -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT "$D" | tail -n +2)"
    if [[ -n "$CONTENT" ]]; then
        echo "$CONTENT" | sed 's/^/           /'
    else
        echo "           (no partitions)"
    fi
    TOTAL=$(( TOTAL + GB ))
done
echo
echo "  Result:  one volume group '$VG' of roughly ${TOTAL} GB,"
echo "           mounted at $MOUNTPOINT"
echo

if (( ${#DISKS[@]} > 1 )); then
    yellow "  Note: with ${#DISKS[@]} chained disks the chance of a failure doubles."
    yellow "  Only public blockchain data lives on them — a failure costs you"
    yellow "  sync time, not money. Never keep the only copy of a wallet file"
    yellow "  there."
    echo
fi

if (( WIPE == 0 )); then
    title "Dry run"
    green "  Nothing was changed."
    echo
    echo "  This was a plan, not an action. To carry it out, add --wipe:"
    echo
    echo "      sudo bash $0 --disks ${DISKS[*]} --wipe"
    echo
    exit 0
fi

# ============================================================= Confirmation ==
red "  All data on the devices listed above will be erased irreversibly."
echo

if (( ASSUME_YES == 0 )); then
    # Without a terminal nobody can confirm. Refuse rather than hang, and
    # refuse rather than assume consent — this is the one place in the whole
    # repository where guessing wrong destroys data.
    if [[ ! -t 0 ]]; then
        red "  No terminal available, so nobody can confirm this."
        echo "  Run it interactively, or pass --yes if you are scripting and"
        echo "  are certain about the device names."
        exit 1
    fi
    # Typing the device path, not "yes". A confirmation you can give without
    # reading is not a confirmation. This one forces you to look at the name
    # of the disk once more — which is exactly where the mistake happens.
    EXPECT="${DISKS[*]}"
    echo "  Type the device path(s) exactly as shown to confirm:"
    printf '      %s\n' "$EXPECT"
    printf '  > '
    read -r ANSWER
    if [[ "$ANSWER" != "$EXPECT" ]]; then
        yellow "  Does not match. Aborted, nothing changed."
        exit 0
    fi
fi

info "Installing LVM tools if needed ..."
if ! command -v pvcreate >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq lvm2 e2fsprogs gdisk >/dev/null
fi
ok "LVM ready"

# ============================================================ Clearing up ====
title "Removing old structures"

if mountpoint -q "$MOUNTPOINT"; then
    umount "$MOUNTPOINT" && ok "$MOUNTPOINT unmounted"
fi

# Tear down existing LVM structures on exactly these devices — typically
# leftovers of an earlier node kit.
for D in "${DISKS[@]}"; do
    while read -r P; do
        [[ -n "$P" ]] || continue
        OLD_VG="$(pvs --noheadings -o vg_name "$P" 2>/dev/null | xargs || true)"
        if [[ -n "$OLD_VG" ]]; then
            warn "removing old volume group '$OLD_VG'"
            vgchange -an "$OLD_VG" >/dev/null 2>&1 || true
            vgremove -f "$OLD_VG" >/dev/null 2>&1 || true
            pvremove -ff -y "$P"  >/dev/null 2>&1 || true
        fi
        umount "$P" 2>/dev/null || true
    done < <(lsblk -lno PATH "$D")
done
ok "cleared"

# ============================================================ Partitioning ===
title "Partitioning"

PVS=()
for D in "${DISKS[@]}"; do
    info "working on $D ..."
    wipefs -a "$D" >/dev/null 2>&1 || true
    sgdisk --zap-all "$D" >/dev/null 2>&1 || true
    # Type 8e00 = Linux LVM
    sgdisk --new=1:0:0 --typecode=1:8e00 --change-name=1:btc "$D" >/dev/null
    partprobe "$D" 2>/dev/null || true
    udevadm settle 2>/dev/null || true
    sleep 2
    P="$(lsblk -lno PATH "$D" | tail -n +2 | head -1)"
    [[ -b "$P" ]] || { red "  no partition was created on $D."; exit 1; }
    PVS+=("$P")
    ok "$P created"
done

# ============================================================ Building LVM ===
title "Building LVM"

vgchange -an "$VG" >/dev/null 2>&1 || true
vgremove -f "$VG"  >/dev/null 2>&1 || true

for P in "${PVS[@]}"; do
    pvcreate -ff -y "$P" >/dev/null
    ok "physical volume: $P"
done

vgcreate "$VG" "${PVS[@]}" >/dev/null
ok "volume group '$VG' from ${#PVS[@]} disks"

# Linear, explicitly NOT striped (no --stripes)
lvcreate -l 100%FREE -n "$LV" "$VG" >/dev/null
ok "logical volume '/dev/$VG/$LV'"

LV_PATH="/dev/${VG}/${LV}"
LV_GB=$(( $(blockdev --getsize64 "$LV_PATH") / 1000000000 ))
ok "size: ${LV_GB} GB"

# ============================================================== Filesystem ===
title "Filesystem"

info "formatting with ext4 (a few minutes at 2 TB) ..."
# -m 1: reserve only 1 % for root instead of 5 % — saves about 80 GB here
mkfs.ext4 -F -m 1 -L bitcoin "$LV_PATH" >/dev/null
ok "ext4 created"

UUID="$(blkid -s UUID -o value "$LV_PATH")"
ok "UUID: $UUID"

mkdir -p "$MOUNTPOINT"

cp /etc/fstab "/etc/fstab.backup.$(date +%Y%m%d-%H%M%S)"
sed -i "\|[[:space:]]${MOUNTPOINT}[[:space:]]|d" /etc/fstab
sed -i "\|^UUID=${UUID}|d" /etc/fstab
# nofail plus a device timeout: without them a disk that does not show up
# leaves the machine sitting in an emergency shell, and on a headless box
# that means it is simply gone from the network.
printf 'UUID=%s  %s  ext4  defaults,noatime,nofail,x-systemd.device-timeout=60  0  2\n' \
    "$UUID" "$MOUNTPOINT" >> /etc/fstab
ok "entered into /etc/fstab (a backup of the old file sits next to it)"

systemctl daemon-reload 2>/dev/null || true
mount "$MOUNTPOINT"
mountpoint -q "$MOUNTPOINT" || { red "  mounting failed."; exit 1; }
ok "mounted at $MOUNTPOINT"

FREE_GB=$(( $(df -B1 --output=avail "$MOUNTPOINT" | tail -1) / 1000000000 ))
ok "usable: ${FREE_GB} GB"

# =============================================================== Read-ahead ==
# USB-SATA bridges often report a nonsensical "optimal I/O size", and the
# kernel turns that into twice as much read-ahead. One enclosure reported
# 32 MB, giving 64 MB of read-ahead where the SD card had 128 KB.
#
# For a node that is not a detail. The chainstate is a LevelDB held through
# mmap, so every UTXO lookup is a 4 KB page fault -- and the kernel pulls up
# to 64 MB for each of them. Measured on 2026-09-01 during the startup check:
# 12.5 MB requested (rchar) against 223 GB read from disk (read_bytes), a
# factor of 18,000. The page cache filled to 3.4 GB, the kernel pushed
# bitcoind's own UTXO cache into swap (61 MB resident against 275 MB swapped),
# and verifying the last six blocks took over half an hour. With 128 KB of
# read-ahead the same check took five seconds.
#
# Note: the value is copied into the file handle when a file is OPENED. A
# running bitcoind does not notice a change -- it has to be restarted.
title "Read-ahead"
cat > /etc/udev/rules.d/60-btcnode-readahead.rules <<'EOF'
# Force read-ahead back to the kernel default. Without this the kernel adopts
# the "optimal I/O size" reported by USB-SATA bridges (often 32 MB) and reads
# a multiple of what is asked for on every random 4 KB access.
ACTION=="add|change", SUBSYSTEM=="block", KERNEL=="sd[a-z]", ATTR{queue/read_ahead_kb}="128"
ACTION=="add|change", SUBSYSTEM=="block", KERNEL=="dm-[0-9]*", ATTR{queue/read_ahead_kb}="128"
EOF
udevadm control --reload
udevadm trigger --subsystem-match=block
udevadm settle --timeout=30 || true
RA_NOW=$(blockdev --getra "$LV_PATH" 2>/dev/null || echo 99999)
if (( RA_NOW <= 512 )); then
    ok "read-ahead: ${RA_NOW} sectors ($(( RA_NOW / 2 )) KB)"
else
    echo "  read-ahead is ${RA_NOW} sectors — the udev rule did not take."
    echo "  by hand: blockdev --setra 256 $LV_PATH"
fi
OPT=$(lsblk -dnbo NAME,OPT-IO 2>/dev/null | awk '{ if ($2+0 > m) m = $2+0 } END { print m+0 }')
if (( OPT > 1048576 )); then
    echo "  (a disk reports ${OPT} bytes as its optimal I/O size — exactly why the rule is here.)"
fi

# ================================================================ Speed test =
title "Speed test"
info "writing 1 GB ..."
dd if=/dev/zero of="$MOUNTPOINT/.speedtest" bs=1M count=1024 conv=fsync 2>&1 | tail -1 | sed 's/^/    /'
sync; echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
info "reading 1 GB back ..."
dd if="$MOUNTPOINT/.speedtest" of=/dev/null bs=1M 2>&1 | tail -1 | sed 's/^/    /'
rm -f "$MOUNTPOINT/.speedtest"
echo
echo "  For scale: above 100 MB/s is good, below 30 MB/s the initial sync drags."

# --- check the power supply again, now that the disk has been under load ----
if command -v vcgencmd >/dev/null 2>&1; then
    W=$(( $(vcgencmd get_throttled | cut -d= -f2) ))
    if (( W == 0 )); then
        ok "power supply stable under load as well"
    else
        echo
        red "  WARNING: undervoltage occurred under load (get_throttled = $(printf '0x%x' "$W"))."
        red "  This is exactly the condition that later corrupts the blockchain"
        red "  database. Get a stronger power supply or a powered USB hub before"
        red "  you continue."
    fi
fi

title "Done"
if (( ${#PVS[@]} > 1 )); then
    green "The ${#PVS[@]} disks now form one ${LV_GB} GB volume at $MOUNTPOINT."
else
    green "The disk is now available as a ${LV_GB} GB volume at $MOUNTPOINT."
    echo
    echo "  Extensible later: a second disk can be added while everything keeps"
    echo "  running, without re-downloading the chain —"
    echo "  pvcreate, vgextend, lvextend, resize2fs."
fi
echo
echo "  Inspect:  sudo vgs  &&  sudo lvs  &&  sudo pvs"
echo
echo "Next step:"
echo "    sudo bash 30-bitcoin-core.sh --datadir $MOUNTPOINT/bitcoin"
echo
