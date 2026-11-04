#!/usr/bin/env bash
#
# 30-bitcoin-core.sh — install Bitcoin Core as a full node.
#
# What happens:
#   - update the system, switch on unattended security updates
#   - set up the firewall (ufw) and fail2ban
#   - spare the SD card: logs into RAM, swap onto the data disk
#   - download Bitcoin Core, verify checksum AND developer signatures
#   - create the service user "bitcoin" without login rights
#   - write a bitcoin.conf matched to the available memory
#   - systemd service with autostart and a clean shutdown
#
# Usage:
#   sudo bash 30-bitcoin-core.sh --datadir /mnt/bitcoin/bitcoin
#
# Options:
#   --datadir PATH   where the chain goes. Default /mnt/bitcoin/bitcoin
#   --version 31.1   a different Bitcoin Core version
#   --prune 600000   keep only ~600 GB of blocks
#   --tor            also talk over Tor (50-tor.sh does this properly later)
#   --no-upnp        no automatic port forwarding in the router
#   --yes            no questions; accept the defaults
#
# Repeatable: running it twice upgrades in place and keeps your credentials.

set -euo pipefail

VERSION="31.1"
DATADIR="/mnt/bitcoin/bitcoin"
PRUNE_MB=0
WITH_TOR=0
UPNP=1
MIN_SIGNATURES=3
BITCOIN_USER="bitcoin"
BASE_URL="https://bitcoincore.org/bin"
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
        --datadir) DATADIR="${2:-}"; shift 2 ;;
        --version) VERSION="${2:-}"; shift 2 ;;
        --prune)   PRUNE_MB="${2:-}"; shift 2 ;;
        --tor)     WITH_TOR=1; shift ;;
        --no-upnp) UPNP=0; shift ;;
        --yes)     ASSUME_YES=1; shift ;;
        -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
        *) red "Unknown option: $1"; exit 1 ;;
    esac
done

[[ $EUID -eq 0 ]] || { red "Please run with sudo."; exit 1; }

# Architecture, rather than insisting on a Pi. The release archive is named
# after it, so a wrong guess fails at the download and not silently later.
case "$(uname -m)" in
    aarch64) ARCH="aarch64-linux-gnu" ;;
    x86_64)  ARCH="x86_64-linux-gnu" ;;
    armv7l)  red "  32-bit ARM. Bitcoin Core needs a 64-bit system."; exit 1 ;;
    *)       red "  Unsupported architecture: $(uname -m)"; exit 1 ;;
esac

ADMIN_USER="${SUDO_USER:-}"
[[ -n "$ADMIN_USER" && "$ADMIN_USER" != "root" ]] || ADMIN_USER=""

ARCHIVE="bitcoin-${VERSION}-${ARCH}.tar.gz"
DIR_URL="${BASE_URL}/bitcoin-core-${VERSION}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# =============================================================== Preconditions
title "Preconditions"
ok "architecture: $(uname -m)"

TARGET_BASE="$(dirname "$DATADIR")"
if mountpoint -q "$TARGET_BASE"; then
    ok "target sits on its own volume $TARGET_BASE"
else
    warn "$TARGET_BASE is not a mount point of its own."
    warn "Is the folder really on the data disk and not on the SD card?"
    warn "If 20-storage.sh has not run yet, please do that first."
    if (( ASSUME_YES == 0 )) && [[ -t 0 ]]; then
        read -r -p "  Continue anyway? [y/N] " A
        [[ "${A,,}" == "y" ]] || exit 0
    fi
fi

FREE_GB=$(( $(df -B1 --output=avail "$TARGET_BASE" | tail -1) / 1000000000 ))
ok "free space: ${FREE_GB} GB"

if (( PRUNE_MB == 0 && FREE_GB < 900 )); then
    echo
    yellow "  For the complete blockchain you want about 900 GB free"
    yellow "  (roughly 750 GB today, plus 5-10 GB per month)."
    echo
    echo "  The alternative is pruning: the node still validates every block in"
    echo "  full and is equally secure. It merely discards old block data after"
    echo "  checking it and can no longer serve those blocks to other nodes."
    echo
    SUGGESTION=$(( (FREE_GB - 100) * 1000 ))
    (( SUGGESTION < 10000 )) && SUGGESTION=10000
    if (( ASSUME_YES == 0 )) && [[ -t 0 ]]; then
        read -r -p "  Switch pruning on at ${SUGGESTION} MB? [Y/n] " A
        [[ "${A,,}" == "n" ]] || PRUNE_MB="$SUGGESTION"
    else
        PRUNE_MB="$SUGGESTION"
    fi
    (( PRUNE_MB > 0 )) && ok "pruning: ${PRUNE_MB} MB"
fi

# This is Bitcoin Core's own default, written out rather than left implicit.
# Since v31 the default depends on memory: 1024 MiB, or 450 MiB once less than
# 4096 MiB is detected. The values are spelled out here so the bitcoin.conf
# says what the node runs with, but they no longer deviate from the default.
#
# Both directions have been paid for. Set too high, it collapses: on a 4 GB Pi
# dbcache once sat at 2000. Fast for two hours (39 blocks/min), then down to
# 13 — dbcache plus bitcoind's own footprint plus the page cache for the block
# files no longer fitted into memory, the kernel pushed 1.1 GB into zram, and
# Core spent a third of its CPU time packing and unpacking its own cache.
#
# Set too low, it starves, and that failure is quieter. Correcting the above by
# hand ended at dbcache=270 with maxmempool=30 — an effective limit of 300 MB.
# At block height 467,000 almost every input then has to be fetched from the
# LevelDB on disk: 300 MB/s read to process 0.5 MB/s of block data, user time
# at 1 per cent. Nothing reports this; the chain just crawls.
#
# Rule of thumb, if you must deviate: at most a quarter of memory, and leave
# the rest to the page cache. The effective limit is dbcache PLUS the free
# mempool space, because Core hands unused mempool room to the UTXO cache.
RAM_MB=$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo) / 1024 ))
CORES="$(nproc)"
if (( RAM_MB >= 4096 )); then DBCACHE=1024
else                          DBCACHE=450
fi
ok "RAM ${RAM_MB} MB, ${CORES} cores — dbcache ${DBCACHE} MB (Core's default)"

# ============================================================ System packages =
title "System packages"
export DEBIAN_FRONTEND=noninteractive
info "refreshing package lists ..."
apt-get update -qq
info "applying security updates (this can take a few minutes) ..."
apt-get upgrade -y -qq
info "installing required packages ..."
apt-get install -y -qq curl gnupg git ca-certificates ufw fail2ban \
    unattended-upgrades apt-listchanges jq python3 >/dev/null
ok "packages installed"

cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
ok "unattended security updates enabled"

# ========================================================== Sparing the card =
# The most common failure of a Pi node is an SD card written to death. Two
# measures move practically all continuous writes onto the data disk.
title "Sparing the boot medium"

mkdir -p /etc/systemd/journald.conf.d
JOURNAL_SSD="${TARGET_BASE}/journal"
if mountpoint -q "$TARGET_BASE"; then
  # Persistent journal on the data disk: /var/log/journal is a bind mount of
  # ${TARGET_BASE}/journal. The directory underneath on the boot medium is made
  # immutable, so if the disk is missing journald cannot write to the card and
  # stays in memory instead.
  install -d -o root -g systemd-journal -m 2755 "$JOURNAL_SSD"
  if ! findmnt -n /var/log/journal >/dev/null 2>&1; then
    mkdir -p /var/log/journal
    if [[ -z "$(ls -A /var/log/journal 2>/dev/null)" ]]; then
      chattr +i /var/log/journal 2>/dev/null || true
    fi
  fi
  if ! grep -qE "^${JOURNAL_SSD}[[:space:]]+/var/log/journal[[:space:]]" /etc/fstab; then
    printf '%s\n' "# Journal on the data disk instead of the boot medium (btcnode setup)" \
      "${JOURNAL_SSD} /var/log/journal none bind,nofail,x-systemd.requires-mounts-for=${TARGET_BASE} 0 0" \
      >> /etc/fstab
    systemctl daemon-reload
  fi
  findmnt -n /var/log/journal >/dev/null 2>&1 || mount /var/log/journal
  rm -f /etc/systemd/journald.conf.d/99-ram.conf
  cat > /etc/systemd/journald.conf.d/99-ssd.conf <<'EOF'
[Journal]
# Persistent logs, but on the data disk: /var/log/journal is a bind mount of
# the data disk (see /etc/fstab). Without the disk the directory underneath is
# immutable and journald stays in memory.
Storage=persistent
SystemMaxUse=200M
RuntimeMaxUse=64M
EOF
  systemctl restart systemd-journald 2>/dev/null || true
  journalctl --flush 2>/dev/null || true
  ok "logs go to the data disk (${JOURNAL_SSD}, 200 MB max)"
else
  cat > /etc/systemd/journald.conf.d/99-ram.conf <<'EOF'
[Journal]
# Logs in memory instead of on the boot medium.
# They are gone after a restart — that is intended here.
Storage=volatile
RuntimeMaxUse=64M
EOF
  systemctl restart systemd-journald 2>/dev/null || true
  ok "data disk not mounted — logs go to memory (64 MB max)"
fi

SWAPFILE="${TARGET_BASE}/swapfile"
if swapon --show=NAME --noheadings 2>/dev/null | grep -qx "$SWAPFILE"; then
    ok "swap file on the data disk already active"
elif mountpoint -q "$TARGET_BASE"; then
    if systemctl list-unit-files 2>/dev/null | grep -q dphys-swapfile; then
        systemctl disable --now dphys-swapfile >/dev/null 2>&1 || true
        ok "swap on the boot medium switched off"
    fi
    info "creating 2 GB on the data disk ..."
    fallocate -l 2G "$SWAPFILE" 2>/dev/null || dd if=/dev/zero of="$SWAPFILE" bs=1M count=2048 status=none
    chmod 600 "$SWAPFILE"
    mkswap "$SWAPFILE" >/dev/null
    swapon "$SWAPFILE"
    grep -q "$SWAPFILE" /etc/fstab || echo "$SWAPFILE none swap sw,nofail 0 0" >> /etc/fstab
    ok "2 GB swap file on the data disk active"
else
    warn "no separate data volume — swap left untouched"
fi

sysctl -qw vm.swappiness=10
grep -q '^vm.swappiness' /etc/sysctl.conf 2>/dev/null || echo 'vm.swappiness=10' >> /etc/sysctl.conf
ok "swapping limited to the bare minimum"

# ================================================================== Firewall =
title "Firewall and SSH"

SSH_PORT="$(awk '/^[[:space:]]*Port[[:space:]]+[0-9]+/ {print $2; exit}' /etc/ssh/sshd_config 2>/dev/null || true)"
[[ -n "$SSH_PORT" ]] || SSH_PORT=22
ok "SSH port: $SSH_PORT"

ufw --force reset >/dev/null 2>&1 || true
ufw default deny incoming  >/dev/null
ufw default allow outgoing >/dev/null
ufw allow "${SSH_PORT}/tcp" comment 'SSH' >/dev/null
ufw allow 8333/tcp comment 'Bitcoin P2P' >/dev/null
ufw --force enable >/dev/null
ok "firewall active: inbound only SSH and port 8333"
info "the RPC port 8332 stays closed and reachable only locally."

KEY_PRESENT=0
for H in /root /home/*; do
    [[ -s "$H/.ssh/authorized_keys" ]] && KEY_PRESENT=1
done

if (( KEY_PRESENT == 1 )); then
    mkdir -p /etc/ssh/sshd_config.d
    cat > /etc/ssh/sshd_config.d/99-node-hardening.conf <<'EOF'
PasswordAuthentication no
PermitRootLogin no
KbdInteractiveAuthentication no
EOF
    if sshd -t 2>/dev/null; then
        systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
        ok "SSH password login disabled (your key stays valid)"
    else
        rm -f /etc/ssh/sshd_config.d/99-node-hardening.conf
        warn "the SSH configuration would have been faulty — change rolled back"
    fi
else
    # Never lock somebody out of their own machine. Without a key on file,
    # switching password login off is how a remote box becomes unreachable.
    warn "no SSH key found. Password login stays enabled so you do not lock"
    warn "yourself out. From your own machine:"
    warn "  ssh-copy-id ${ADMIN_USER:-pi}@$(hostname).local"
fi

systemctl enable --now fail2ban >/dev/null 2>&1 || true
ok "fail2ban is running"

# ================================================= Download Bitcoin Core =====
title "Downloading Bitcoin Core ${VERSION}"

cd "$WORK"
info "fetching $ARCHIVE (about 50 MB) ..."
curl -fsSL --retry 3 -O "${DIR_URL}/${ARCHIVE}"
curl -fsSL --retry 3 -O "${DIR_URL}/SHA256SUMS"
curl -fsSL --retry 3 -O "${DIR_URL}/SHA256SUMS.asc"
ok "downloaded"

title "Checksum"
if sha256sum --ignore-missing --check SHA256SUMS 2>/dev/null | grep -q "${ARCHIVE}: OK"; then
    ok "checksum matches"
else
    red "  Checksum wrong. File incomplete or tampered with. Aborting."
    exit 1
fi

# The checksum alone proves nothing: whoever could swap the archive could swap
# SHA256SUMS with it. What carries the weight is that several people compiled
# the source independently and arrived at the same binary, and signed that.
title "Developer signatures"
info "fetching the signing keys from the guix.sigs repository ..."
export GNUPGHOME="$WORK/gnupg"
mkdir -p "$GNUPGHOME"; chmod 700 "$GNUPGHOME"
git clone -q --depth 1 https://github.com/bitcoin-core/guix.sigs "$WORK/guix.sigs"
gpg --quiet --import "$WORK"/guix.sigs/builder-keys/*.gpg 2>/dev/null || true
ok "$(gpg --list-keys --with-colons 2>/dev/null | grep -c '^pub') developer keys imported"

info "verifying the signatures ..."
VERIFY="$(gpg --verify SHA256SUMS.asc SHA256SUMS 2>&1 || true)"
GOOD=$(grep -c 'Good signature' <<<"$VERIFY" || true)
BAD=$(grep -c 'BAD signature' <<<"$VERIFY" || true)

if (( BAD > 0 )); then
    red "  ${BAD} INVALID signature(s). Stopping immediately."
    echo "$VERIFY"; exit 1
fi
if (( GOOD < MIN_SIGNATURES )); then
    red "  Only ${GOOD} valid signature(s), at least ${MIN_SIGNATURES} expected."
    echo "$VERIFY"; exit 1
fi

green "  ${GOOD} independent developer signatures confirm these checksums."
info "Several people compiled the source separately from each other and"
info "arrived at exactly the same binary."

# ================================================================ Installing =
title "Installing"

tar -xzf "$ARCHIVE"
SOURCE="$WORK/bitcoin-${VERSION}"
[[ -d "$SOURCE/bin" ]] || { red "  unexpected archive content."; exit 1; }

if systemctl is-active --quiet bitcoind 2>/dev/null; then
    info "stopping the running service for the upgrade ..."
    systemctl stop bitcoind
fi

rm -f "$SOURCE/bin/bitcoin-qt" "$SOURCE/bin/test_bitcoin"
install -m 0755 -o root -g root "$SOURCE"/bin/* /usr/local/bin/
ok "binaries in /usr/local/bin"
/usr/local/bin/bitcoind --version | head -1 | sed 's/^/  /'

if ! id -u "$BITCOIN_USER" >/dev/null 2>&1; then
    useradd --system --shell /usr/sbin/nologin --home-dir "$DATADIR" "$BITCOIN_USER"
    ok "service user '$BITCOIN_USER' created (cannot log in)"
else
    ok "service user '$BITCOIN_USER' present"
fi

mkdir -p "$DATADIR"
chown -R "${BITCOIN_USER}:${BITCOIN_USER}" "$DATADIR"
chmod 750 "$DATADIR"

# ============================================================== Credentials ==
title "Credentials"

CONF="${DATADIR}/bitcoin.conf"
SECRETS="/etc/bitcoin-access.conf"

if [[ -f "$SECRETS" ]] && grep -q '^ADMIN_RPCAUTH=' "$SECRETS"; then
    # shellcheck disable=SC1090
    . "$SECRETS"
    ok "existing credentials kept"
else
    make_account() {
        python3 - "$1" <<'PY'
import hashlib, hmac, os, secrets, sys
user = sys.argv[1]
pw   = secrets.token_urlsafe(32)
salt = os.urandom(16).hex()
h    = hmac.new(salt.encode(), pw.encode(), hashlib.sha256).hexdigest()
print(f"{user}:{salt}${h}")
print(pw)
PY
    }
    A="$(make_account bitcoinadmin)"
    ADMIN_RPCAUTH="$(sed -n 1p <<<"$A")"; ADMIN_PASS="$(sed -n 2p <<<"$A")"
    D="$(make_account dashboard)"
    DASH_RPCAUTH="$(sed -n 1p <<<"$D")"; DASH_PASS="$(sed -n 2p <<<"$D")"

    umask 077
    cat > "$SECRETS" <<EOF
# Credentials for the local control of Bitcoin Core.
# Readable by root only. The dashboard installer reuses the second account.
ADMIN_RPCAUTH='${ADMIN_RPCAUTH}'
ADMIN_USER_RPC='bitcoinadmin'
ADMIN_PASS='${ADMIN_PASS}'
DASH_RPCAUTH='${DASH_RPCAUTH}'
DASH_USER_RPC='dashboard'
DASH_PASS='${DASH_PASS}'
EOF
    chmod 600 "$SECRETS"
    ok "two separate random passwords generated (admin and dashboard)"
fi

# ============================================================ Configuration ==
title "Configuration"

# Core's default as well. Note that during the initial sync the mempool is
# empty, so its whole size counts towards the UTXO cache: the effective limit
# is dbcache PLUS maxmempool, i.e. 750 MB on a 4 GB machine. That is about a
# fifth of memory and stays inside the rule of thumb above.
MAXMEMPOOL=300

cat > "$CONF" <<EOF
# ---------------------------------------------------------------------------
# bitcoin.conf — generated on $(date '+%Y-%m-%d %H:%M')
# ---------------------------------------------------------------------------

# --- Operation -------------------------------------------------------------
daemon=0
# 0, because systemd manages the process in the foreground itself
server=1

# --- Performance -----------------------------------------------------------
dbcache=${DBCACHE}
# Core's default for this amount of memory. The single biggest lever for the
# initial sync. Do not raise it without reading the note in 30-bitcoin-core.sh.
par=${CORES}
maxmempool=${MAXMEMPOOL}
# Core adds unused mempool room to the UTXO cache, so the effective cache limit
# is dbcache PLUS the free mempool — during the initial sync that is all of it.

# --- Network ---------------------------------------------------------------
listen=1
maxconnections=40
# Deliberately limited on a small machine: every connection costs memory
upnp=${UPNP}
EOF

if (( PRUNE_MB > 0 )); then
    cat >> "$CONF" <<EOF

# --- Disk space ------------------------------------------------------------
prune=${PRUNE_MB}
# The node still validates every block in full. It merely does not keep the
# complete archive and cannot serve old blocks to others.
EOF
else
    cat >> "$CONF" <<'EOF'

# --- Extra index -----------------------------------------------------------
blockfilterindex=1
# Costs about 10 GB and lets you attach a wallet to your own node later on
# without handing your addresses to a stranger's server.
EOF
fi

if (( WITH_TOR == 1 )); then
    cat >> "$CONF" <<'EOF'

# --- Tor -------------------------------------------------------------------
proxy=127.0.0.1:9050
listenonion=1
onlynet=onion
EOF
fi

cat >> "$CONF" <<EOF

# --- Remote control (reachable over 127.0.0.1 only) ------------------------
rpcauth=${ADMIN_RPCAUTH}
rpcauth=${DASH_RPCAUTH}
rpcbind=127.0.0.1
rpcallowip=127.0.0.1

# The dashboard may call these ten read-only commands and nothing else. Even
# if its password leaked, nothing could be done with it: no wallet, no
# sending, no configuration, no shutdown.
rpcwhitelist=dashboard:getblockchaininfo,getnetworkinfo,getmempoolinfo,uptime,getpeerinfo,getblockstats,getnetworkhashps,estimatesmartfee
# 0 means the restriction applies only to users listed here. The admin
# account keeps its full range.
rpcwhitelistdefault=0

# --- Log -------------------------------------------------------------------
shrinkdebugfile=1
EOF

chown "${BITCOIN_USER}:${BITCOIN_USER}" "$CONF"
chmod 640 "$CONF"
ok "configuration written to $CONF"
ok "dashboard account limited to read-only commands"

if (( WITH_TOR == 1 )); then
    info "installing Tor ..."
    apt-get install -y -qq tor >/dev/null
    if ! grep -q 'ControlPort 9051' /etc/tor/torrc 2>/dev/null; then
        printf '\nControlPort 9051\nCookieAuthentication 1\nCookieAuthFileGroupReadable 1\n' >> /etc/tor/torrc
    fi
    usermod -aG debian-tor "$BITCOIN_USER" 2>/dev/null || true
    systemctl restart tor
    ok "Tor set up"
fi

# ================================================================== Service ==
title "System service"

cat > /etc/systemd/system/bitcoind.service <<EOF
[Unit]
Description=Bitcoin Core full node
Documentation=https://github.com/bitcoin/bitcoin
After=network-online.target
Wants=network-online.target
# Without the data volume mounted the service must not even start
RequiresMountsFor=${TARGET_BASE}

[Service]
Type=simple
User=${BITCOIN_USER}
Group=${BITCOIN_USER}
ExecStart=/usr/local/bin/bitcoind -datadir=${DATADIR} -conf=${CONF} -pid=/run/bitcoind/bitcoind.pid
PIDFile=/run/bitcoind/bitcoind.pid
RuntimeDirectory=bitcoind
RuntimeDirectoryMode=0710

Restart=on-failure
RestartSec=30
TimeoutStartSec=infinity
# A clean shutdown flushes the database cache. If it is cut short, the
# blockchain database is corrupt afterwards.
TimeoutStopSec=900
KillSignal=SIGINT
SendSIGKILL=no

# --- Confinement ---
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=full
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
# AF_NETLINK belongs here although it looks like more than necessary: Bitcoin
# Core determines its own local addresses via getifaddrs(), and that only
# works over a netlink socket. Without this entry it writes
# "socket(AF_NETLINK): Address family not supported (97)" as an [error] into
# the log on every attempt. All it reads is the list of local interfaces.
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
ReadWritePaths=${DATADIR}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable bitcoind >/dev/null
ok "service installed and set to start at boot"

info "starting Bitcoin Core ..."
systemctl start bitcoind
sleep 12

if systemctl is-active --quiet bitcoind; then
    green "  Bitcoin Core is running."
else
    red "  Start failed. Last messages:"
    journalctl -u bitcoind -n 40 --no-pager | sed 's/^/    /'
    exit 1
fi

# ================================================================ Usability ==
title "Setting up the command line"

if [[ -n "$ADMIN_USER" && -n "${ADMIN_PASS:-}" ]]; then
    ADMIN_HOME="$(getent passwd "$ADMIN_USER" | cut -d: -f6)"
    mkdir -p "$ADMIN_HOME/.bitcoin"
    cat > "$ADMIN_HOME/.bitcoin/bitcoin.conf" <<EOF
# Credentials for bitcoin-cli only — no node runs from this file.
rpcconnect=127.0.0.1
rpcuser=bitcoinadmin
rpcpassword=${ADMIN_PASS}
EOF
    chown -R "${ADMIN_USER}:${ADMIN_USER}" "$ADMIN_HOME/.bitcoin"
    chmod 600 "$ADMIN_HOME/.bitcoin/bitcoin.conf"
    ok "bitcoin-cli usable for '$ADMIN_USER' without further arguments"
fi

cat > /usr/local/bin/node-status <<'EOF'
#!/usr/bin/env bash
set -u
if ! systemctl is-active --quiet bitcoind; then
    echo "Bitcoin Core is NOT running."
    echo "Last messages:  journalctl -u bitcoind -n 50 --no-pager"
    exit 1
fi
I="$(bitcoin-cli getblockchaininfo 2>/dev/null)" || {
    echo "Node is still starting or loading index files — try again in a few minutes."
    exit 0; }
awk -v p="$(jq -r .verificationprogress <<<"$I")" \
    'BEGIN { printf "Progress      %.2f %%\n", p*100 }'
printf 'Blocks        %s of %s\n' "$(jq -r .blocks <<<"$I")" "$(jq -r .headers <<<"$I")"
printf 'On disk       %s GB\n'    "$(jq -r '.size_on_disk/1000000000|floor' <<<"$I")"
printf 'Connections   %s\n'       "$(bitcoin-cli getconnectioncount 2>/dev/null || echo '?')"
printf 'Running since %s\n'       "$(systemctl show bitcoind -p ActiveEnterTimestamp --value)"
EOF
chmod +x /usr/local/bin/node-status
ok "command 'node-status' installed"

# ===================================================================== Done ==
title "Done"
green "Your Bitcoin full node is running and will start automatically from now on."
echo
echo "  Version   Bitcoin Core ${VERSION}"
echo "  Data      ${DATADIR}"
if (( PRUNE_MB > 0 )); then
    echo "  Mode      pruning at ${PRUNE_MB} MB (fully validating)"
else
    echo "  Mode      full archive"
fi
(( WITH_TOR == 1 )) && echo "  Tor       active"
echo
echo "  Commands:"
echo "    node-status                     see the progress"
echo "    journalctl -u bitcoind -f       follow the log"
echo "    sudo systemctl stop bitcoind    stop it cleanly"
echo
yellow "  The initial sync typically takes 3 to 10 days on a Raspberry Pi 4."
yellow "  Never pull the plug — always 'sudo systemctl stop bitcoind' or 'sudo reboot'."
echo
echo "Next steps:"
echo "    sudo bash 40-electrs.sh          Electrum server for your wallet"
echo "    sudo bash 50-tor.sh              reachable over Tor"
echo
