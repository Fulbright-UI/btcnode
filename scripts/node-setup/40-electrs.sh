#!/usr/bin/env bash
#
# 40-electrs.sh — set up an Electrum server (electrs) for your wallet.
#
# Wallets like BitBoxApp, Sparrow or Electrum do not talk to Bitcoin Core
# directly, they talk to an Electrum server. It prepares the blockchain so the
# wallet can ask for the balance and history of your addresses — without any
# stranger's server ever learning which addresses are yours.
#
# Requirements:
#   - Bitcoin Core running WITHOUT pruning and fully synced
#   - about 60 GB free for the index (up to 90 GB while it is being built)
#
# Usage:  sudo bash 40-electrs.sh
#
# Options:
#   --version 0.11.1   a different electrs version
#   --port 50001       a different port
#   --no-tor           do not set up onion access
#   --build-now        start even if the node is not fully synced yet
#   --yes              no questions

set -euo pipefail

ELECTRS_VERSION="0.11.1"
WITH_TOR=1
FORCE=0
ELECTRS_USER="electrs"
ELECTRS_PORT=50001
DB_DIR=""
DATADIR=""
SECRETS="/etc/bitcoin-access.conf"
ASSUME_YES=0

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
title()  { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
ok()     { printf '  [ ok ] %s\n' "$*"; }
info()   { printf '  ...... %s\n' "$*"; }
warn()   { printf '  [ !! ] %s\n' "$*"; }

# Asks only when someone can answer. In a pipe the default decides.
confirm() {
    (( ASSUME_YES == 1 )) && return 0
    [[ -t 0 ]] || return 1
    read -r -p "  $1 [y/N] " A
    [[ "${A,,}" == "y" ]]
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --version)    ELECTRS_VERSION="${2:-}"; shift 2 ;;
        --port)       ELECTRS_PORT="${2:-}"; shift 2 ;;
        --no-tor)     WITH_TOR=0; shift ;;
        --build-now)  FORCE=1; shift ;;
        --yes)        ASSUME_YES=1; shift ;;
        -h|--help)    sed -n '2,22p' "$0"; exit 0 ;;
        *) red "Unknown option: $1"; exit 1 ;;
    esac
done

[[ $EUID -eq 0 ]] || { red "Please run with sudo."; exit 1; }

# The build runs as the ordinary user, not as root: cargo pulls in a few
# hundred crates, and there is no reason to let that happen with full
# privileges.
ADMIN_USER="${SUDO_USER:-}"
[[ -n "$ADMIN_USER" && "$ADMIN_USER" != "root" ]] \
    || { red "  Please start as a normal user with sudo, not directly as root."; exit 1; }
ADMIN_HOME="$(getent passwd "$ADMIN_USER" | cut -d: -f6)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# =============================================================== Preconditions
title "Preconditions"

[[ -f "$SECRETS" ]] || { red "  $SECRETS missing. Please run 30-bitcoin-core.sh first."; exit 1; }
# shellcheck disable=SC1090
. "$SECRETS"

systemctl is-active --quiet bitcoind || { red "  Bitcoin Core is not running."; exit 1; }
ok "Bitcoin Core is running"

DATADIR="$(awk -F'-datadir=' '/ExecStart/ {split($2,a," "); print a[1]}' \
    /etc/systemd/system/bitcoind.service 2>/dev/null || true)"
[[ -n "$DATADIR" ]] || DATADIR="/mnt/bitcoin/bitcoin"
BASE="$(dirname "$DATADIR")"
DB_DIR="${BASE}/electrs"
ok "Bitcoin data: $DATADIR"
ok "Electrum index: $DB_DIR"

# --- pruning rules this out -------------------------------------------------
CHAIN="$(sudo -u "$ADMIN_USER" bitcoin-cli getblockchaininfo 2>/dev/null || true)"
if [[ -z "$CHAIN" ]]; then
    red "  Bitcoin Core does not answer bitcoin-cli. Is it really up?"
    exit 1
fi

if grep -q '"pruned": *true' <<<"$CHAIN"; then
    red "  The node runs with pruning. electrs needs the complete blockchain."
    red "  Remove 'prune=' from $DATADIR/bitcoin.conf and re-sync."
    exit 1
fi
ok "node keeps the complete blockchain"

PROGRESS="$(python3 -c "import json,sys; print(json.load(sys.stdin)['verificationprogress'])" <<<"$CHAIN")"
PERCENT="$(python3 -c 'import sys; print(f"{float(sys.argv[1])*100:.2f}")' "$PROGRESS")"
if python3 -c 'import sys; sys.exit(0 if float(sys.argv[1]) > 0.9999 else 1)' "$PROGRESS"; then
    SYNCED=1
    ok "blockchain in sync (${PERCENT} %)"
else
    SYNCED=0
    echo
    yellow "  The node is only ${PERCENT} % synced."
    yellow "  electrs will be built and installed, but left switched off:"
    yellow "  its first index pass and the initial sync fight over the same"
    yellow "  disk and the same cores, and neither finishes sooner for it."
    if (( FORCE == 0 )); then
        confirm "Build it anyway?" || { echo "  Aborted. Come back when the node is done."; exit 0; }
    fi
fi

FREE_GB=$(( $(df -B1 --output=avail "$BASE" | tail -1) / 1000000000 ))
if (( FREE_GB < 80 )); then
    red "  Only ${FREE_GB} GB free. The index needs about 45 GB, and up to 90 GB"
    red "  temporarily while it is being built. Aborting."
    exit 1
fi
ok "free space: ${FREE_GB} GB (the index needs about 45 GB)"

# ============================================================== Build tooling =
title "Build tooling"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
info "installing compiler and libraries ..."
apt-get install -y -qq build-essential libclang-dev git cargo pkg-config >/dev/null
ok "Rust $(cargo --version 2>/dev/null | awk '{print $2}') from the Debian packages"

# Linking dynamically against the system RocksDB: faster to build, far less
# memory while building, and apt closes security holes along with it.
ROCKS=0
if apt-get install -y -qq librocksdb-dev >/dev/null 2>&1; then
    ROCKS_VER="$(dpkg-query -W -f='${Version}' librocksdb-dev 2>/dev/null || true)"
    if [[ "$ROCKS_VER" == 9.10.0* ]]; then
        ROCKS=1
        ok "librocksdb-dev ${ROCKS_VER} — will be linked dynamically"
    else
        warn "librocksdb-dev ${ROCKS_VER} does not match electrs ${ELECTRS_VERSION} (expects 9.10.0)"
        warn "Building statically instead — that takes longer."
    fi
fi
(( ROCKS == 0 )) && info "static build: expect 40 to 70 minutes on a Pi"

# ============================================================ Getting sources =
title "Fetching and checking the source"

BUILDDIR="${ADMIN_HOME}/.cache/electrs-build"
sudo -u "$ADMIN_USER" mkdir -p "$BUILDDIR"

if [[ -d "$BUILDDIR/electrs/.git" ]]; then
    info "updating the existing working copy ..."
    sudo -u "$ADMIN_USER" git -C "$BUILDDIR/electrs" fetch --tags --quiet origin
else
    info "cloning github.com/romanz/electrs ..."
    sudo -u "$ADMIN_USER" git clone --quiet https://github.com/romanz/electrs "$BUILDDIR/electrs"
fi

cd "$BUILDDIR/electrs"
sudo -u "$ADMIN_USER" git checkout --quiet "v${ELECTRS_VERSION}" 2>/dev/null \
    || { red "  version v${ELECTRS_VERSION} not found."; exit 1; }
ok "at v${ELECTRS_VERSION}"

# --- verify the signature on the git tag ------------------------------------
info "checking the signature on the tag ..."
TAG_CHECK="$(sudo -u "$ADMIN_USER" git verify-tag "v${ELECTRS_VERSION}" 2>&1 || true)"

# Roman Zeyde signs with an SSH key, not with GPG. Git can verify that but
# needs a list of trusted keys for it.
if grep -q 'allowedSignersFile' <<<"$TAG_CHECK"; then
    info "the tag is SSH-signed, fetching the signing key from GitHub ..."
    SIGNER_FILE="${ADMIN_HOME}/.config/git/allowed_signers"
    sudo -u "$ADMIN_USER" mkdir -p "$(dirname "$SIGNER_FILE")"
    # The key list is data, not code: save it, then read it into Python.
    if curl -fsSL --retry 3 -o "${WORK}/romanz_keys.json" \
            https://api.github.com/users/romanz/ssh_signing_keys \
        && python3 -c "import json,sys
keys = json.load(sys.stdin)
if not keys:
    sys.exit(1)
for k in keys:
    print('romanz', k['key'])" < "${WORK}/romanz_keys.json" \
            > "${WORK}/allowed_signers" 2>/dev/null \
        && [[ -s "${WORK}/allowed_signers" ]]; then
        install -m 0644 -o "$ADMIN_USER" -g "$ADMIN_USER" \
            "${WORK}/allowed_signers" "$SIGNER_FILE"
        sudo -u "$ADMIN_USER" git config --global \
            gpg.ssh.allowedSignersFile "$SIGNER_FILE"
        ok "$(wc -l < "$SIGNER_FILE") signing key(s) registered"
        TAG_CHECK="$(sudo -u "$ADMIN_USER" git verify-tag "v${ELECTRS_VERSION}" 2>&1 || true)"
    else
        warn "the signing keys could not be fetched"
    fi
fi

# SSH signatures report differently from GPG: 'Good "git" signature'
SIGNATURE_OK=0
if grep -q 'Good "git" signature' <<<"$TAG_CHECK"; then
    green "  The tag carries a valid SSH signature by romanz."
    grep -oE 'with [A-Z0-9]+ key SHA256:[A-Za-z0-9+/=]+' <<<"$TAG_CHECK" | sed 's/^/    /'
    # Worth being honest about: this proves the source was not tampered with
    # in transit. It does not prove anything about a compromised account.
    info "Note: the key comes from GitHub, i.e. from the same place as the"
    info "source. That protects against tampering in transit, not against a"
    info "taken-over GitHub account."
    SIGNATURE_OK=1
fi

if (( SIGNATURE_OK == 1 )); then
    :   # SSH signature already confirmed above
elif grep -q 'Good signature' <<<"$TAG_CHECK"; then
    green "  The tag is validly signed (GPG)."
    grep -oE 'using [A-Za-z]+ key [A-F0-9]+' <<<"$TAG_CHECK" | sed 's/^/    /'
elif grep -qi "No public key\|can't check signature" <<<"$TAG_CHECK"; then
    KEY_ID="$(grep -oE '[A-F0-9]{16}' <<<"$TAG_CHECK" | head -1)"
    warn "the signing key is not present locally."
    if [[ -n "$KEY_ID" ]]; then
        info "fetching key $KEY_ID from the key server ..."
        sudo -u "$ADMIN_USER" gpg --quiet --keyserver hkps://keys.openpgp.org \
            --recv-keys "$KEY_ID" 2>/dev/null || true
        TAG_CHECK="$(sudo -u "$ADMIN_USER" git verify-tag "v${ELECTRS_VERSION}" 2>&1 || true)"
    fi
    if grep -q 'Good signature' <<<"$TAG_CHECK"; then
        green "  The tag is validly signed."
    else
        echo
        yellow "  The signature could not be confirmed."
        echo "$TAG_CHECK" | sed 's/^/    /'
        echo
        yellow "  That need not mean anything bad — the key may simply be missing."
        yellow "  Compare the fingerprint above with the one Roman Zeyde publishes"
        yellow "  on his GitHub profile before you continue."
        confirm "Continue?" || exit 0
    fi
else
    warn "signature check inconclusive:"
    echo "$TAG_CHECK" | sed 's/^/    /'
    confirm "Continue?" || exit 0
fi

# =================================================================== Building =
title "Building electrs"
yellow "  This takes roughly 20 to 60 minutes on a Pi 4. Leave the window open."
echo

BUILD=(cargo build --locked --release)
if (( ROCKS == 1 )); then
    sudo -u "$ADMIN_USER" env \
        ROCKSDB_INCLUDE_DIR=/usr/include ROCKSDB_LIB_DIR=/usr/lib \
        CARGO_HOME="${ADMIN_HOME}/.cargo" \
        "${BUILD[@]}"
else
    sudo -u "$ADMIN_USER" env CARGO_HOME="${ADMIN_HOME}/.cargo" "${BUILD[@]}"
fi

BINARY="$BUILDDIR/electrs/target/release/electrs"
[[ -x "$BINARY" ]] || { red "  build failed — no executable was produced."; exit 1; }
install -m 0755 -o root -g root "$BINARY" /usr/local/bin/electrs
ok "electrs installed in /usr/local/bin"
/usr/local/bin/electrs --version | sed 's/^/  /'

# ======================================================= Access to the node ==
title "Access to Bitcoin Core"

BTC_CONF="${DATADIR}/bitcoin.conf"

if grep -q "^rpcauth=electrs:" "$BTC_CONF" 2>/dev/null && [[ -n "${ELECTRS_PASS:-}" ]]; then
    ok "account already exists"
else
    PAIR="$(python3 - <<'PY'
import hashlib, hmac, os, secrets
pw = secrets.token_urlsafe(32); salt = os.urandom(16).hex()
print(f"electrs:{salt}${hmac.new(salt.encode(), pw.encode(), hashlib.sha256).hexdigest()}")
print(pw)
PY
)"
    ELECTRS_RPCAUTH="$(sed -n 1p <<<"$PAIR")"
    ELECTRS_PASS="$(sed -n 2p <<<"$PAIR")"

    cp "$BTC_CONF" "${BTC_CONF}.backup.$(date +%Y%m%d-%H%M%S)"
    sed -i '/^rpcauth=electrs:/d' "$BTC_CONF"
    printf '\n# --- Electrum server ---\nrpcauth=%s\n' "$ELECTRS_RPCAUTH" >> "$BTC_CONF"

    sed -i '/^ELECTRS_/d' "$SECRETS"
    {
        printf "ELECTRS_RPCAUTH='%s'\n" "$ELECTRS_RPCAUTH"
        printf "ELECTRS_PASS='%s'\n" "$ELECTRS_PASS"
    } >> "$SECRETS"
    chmod 600 "$SECRETS"
    ok "separate RPC account for electrs created"

    info "restarting Bitcoin Core so the account takes effect ..."
    systemctl restart bitcoind
    sleep 20
    systemctl is-active --quiet bitcoind || { red "  Bitcoin Core no longer starts."; exit 1; }
    ok "Bitcoin Core is running again"
fi

# ================================================================ Setting up =
title "Setting up electrs"

if ! id -u "$ELECTRS_USER" >/dev/null 2>&1; then
    useradd --system --shell /usr/sbin/nologin --home-dir "$DB_DIR" --no-create-home "$ELECTRS_USER"
    ok "service user '$ELECTRS_USER' created"
fi

mkdir -p "$DB_DIR"
chown -R "${ELECTRS_USER}:${ELECTRS_USER}" "$DB_DIR"
chmod 750 "$DB_DIR"

mkdir -p /etc/electrs
umask 077
cat > /etc/electrs/config.toml <<EOF
# electrs — Electrum server for your own wallet
network = "bitcoin"
db_dir = "${DB_DIR}"
daemon_dir = "${DATADIR}"
daemon_rpc_addr = "127.0.0.1:8332"
daemon_p2p_addr = "127.0.0.1:8333"
auth = "electrs:${ELECTRS_PASS}"

# Listen locally only. Access from the local network goes through the
# forwarder below, access from outside through Tor.
electrum_rpc_addr = "127.0.0.1:${ELECTRS_PORT}"

# Prometheus metrics are not needed
monitoring_addr = "127.0.0.1:4224"

log_filters = "INFO"
index_lookup_limit = 200
server_banner = "$(hostname) — private node"
EOF
chown root:"$ELECTRS_USER" /etc/electrs/config.toml
chmod 640 /etc/electrs/config.toml
ok "configuration in /etc/electrs/config.toml"

# electrs reads the block files directly; that needs group read on the data dir
usermod -aG bitcoin "$ELECTRS_USER"
chmod 750 "$DATADIR"
ok "read access to the block files granted"

cat > /etc/systemd/system/electrs.service <<EOF
[Unit]
Description=Electrum server (electrs)
After=bitcoind.service
Requires=bitcoind.service
RequiresMountsFor=${BASE}

[Service]
Type=simple
User=${ELECTRS_USER}
Group=${ELECTRS_USER}
SupplementaryGroups=bitcoin
ExecStart=/usr/local/bin/electrs --conf /etc/electrs/config.toml
Restart=on-failure
RestartSec=30
TimeoutStopSec=300
KillSignal=SIGINT
Nice=10

NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictNamespaces=true
LockPersonality=true
ReadWritePaths=${DB_DIR}
ReadOnlyPaths=${DATADIR}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload

# While the chain is still coming down, electrs stays off. Its first index
# pass reads the whole blockchain and writes its own database — the same disk,
# the same cores, the same memory bandwidth Bitcoin Core is using to validate.
# On a 4 GB Pi the two do not fit beside each other: both get slower and
# neither finishes sooner.
#
# Not just stopped but not enabled either, because a machine that reboots
# during the sync would otherwise bring it straight back. 60-tor-automatic.sh
# switches it on after the node has moved to Tor; by hand it is one command.
if (( SYNCED == 1 )); then
    systemctl enable --now electrs >/dev/null
    sleep 8
    if systemctl is-active --quiet electrs; then
        ok "electrs is running and starting to index"
    else
        red "  start failed:"
        journalctl -u electrs -n 30 --no-pager | sed 's/^/    /'
        exit 1
    fi
else
    warn "electrs is installed but NOT started — the chain is not up yet"
    info "60-tor-automatic.sh switches it on, or do it yourself once synced:"
    info "    sudo systemctl enable --now electrs"
fi

# ====================================================== Reachable on the LAN =
title "Access from the local network"

LOCAL_IP="$(ip -4 -o route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')"
CIDR="$(ip -4 -o addr show 2>/dev/null | awk -v ip="$LOCAL_IP" '$4 ~ "^"ip"/" {print $4}' | head -1)"
SUBNET="$(python3 -c "import ipaddress,sys; print(ipaddress.ip_network(sys.argv[1], strict=False))" "$CIDR")"

# electrs listens on 127.0.0.1 only. To let a wallet on the LAN reach it we
# forward the port — that way electrs itself stays untouched and keeps its
# loopback-only binding.
apt-get install -y -qq socat >/dev/null
cat > /etc/systemd/system/electrs-lan.service <<EOF
[Unit]
Description=Make the Electrum server reachable on the local network
After=electrs.service
Requires=electrs.service
# socat binds one fixed address, and that address usually arrives over DHCP.
# Without waiting for the network the unit can start before the interface has
# it, and the bind fails. Seen on 2026-09-01: the service sat in 'failed'
# while electrs itself was fine.
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/socat TCP-LISTEN:${ELECTRS_PORT},fork,reuseaddr,bind=${LOCAL_IP} TCP:127.0.0.1:${ELECTRS_PORT}
Restart=always
RestartSec=10
DynamicUser=yes

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
RestrictAddressFamilies=AF_INET AF_INET6

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
# Requires=electrs.service — it cannot run before electrs does, so it waits
# for the same moment.
if (( SYNCED == 1 )); then
    systemctl enable --now electrs-lan >/dev/null
    ok "port ${ELECTRS_PORT} reachable on the LAN at ${LOCAL_IP}"
else
    ok "LAN forwarding prepared for ${LOCAL_IP}:${ELECTRS_PORT}, starts with electrs"
fi

# Our own rule is recognised by its comment, not by the port: an unanchored
# grep "50001/tcp" would also match 150001/tcp, and the loop deleted every
# hit without a word (2026-09-06). --force instead of "yes |": under
# pipefail, yes dies of SIGPIPE when ufw exits and "|| break" left the loop
# after the first of two rules (v4 deleted, v6 kept).
UFW_MARK='Electrum LAN'
while :; do
    NR="$(ufw status numbered 2>/dev/null | grep -E "# ${UFW_MARK}[[:space:]]*\$" \
          | head -1 | tr -d '[]' | awk '{print $1}')"
    [[ "$NR" =~ ^[0-9]+$ ]] || break
    ufw --force delete "$NR" >/dev/null 2>&1 || break
done
ufw allow from "$SUBNET" to any port "$ELECTRS_PORT" proto tcp comment "$UFW_MARK" >/dev/null
ok "firewall: port ${ELECTRS_PORT} from ${SUBNET} only"

# ======================================================================= Tor =
ONION=""
if (( WITH_TOR == 1 )); then
    title "Tor access from outside"
    apt-get install -y -qq tor >/dev/null

    if ! grep -q 'HiddenServiceDir /var/lib/tor/electrs' /etc/tor/torrc 2>/dev/null; then
        cat >> /etc/tor/torrc <<EOF

# Electrum server for your wallet
HiddenServiceDir /var/lib/tor/electrs/
HiddenServicePort ${ELECTRS_PORT} 127.0.0.1:${ELECTRS_PORT}
EOF
    fi
    systemctl restart tor
    sleep 8

    ONION="$(cat /var/lib/tor/electrs/hostname 2>/dev/null || true)"
    if [[ -n "$ONION" ]]; then
        # /var/lib/tor/electrs belongs to debian-tor with mode 700, and rightly
        # so. Rather than giving other services access to Tor's data directory,
        # we put the address at a neutral, readable place.
        mkdir -p /etc/electrs
        printf '%s\n' "$ONION" > /etc/electrs/onion
        chmod 644 /etc/electrs/onion
        ok "onion service set up, address stored in /etc/electrs/onion"
        info "Tor encrypts and authenticates the connection by itself."
        info "No port forwarding needed, no fixed IP needed."
    else
        warn "onion address not generated yet — look later at:"
        warn "  sudo cat /var/lib/tor/electrs/hostname"
    fi
fi

# ====================================================================== Done =
title "Done"
if (( SYNCED == 1 )); then
    green "electrs is running and now builds its index."
    echo
    yellow "  That takes roughly 1 to 3 days on a Pi 4. Until then no wallet can"
    yellow "  connect. Follow the progress with:"
    echo "      journalctl -u electrs -f"
    echo
    echo "  Once 'finished full compaction' appears in the log, it is ready."
    echo
else
    green "electrs is installed. It is not running yet, on purpose."
    echo
    yellow "  Its first index pass would fight the initial sync over the same"
    yellow "  disk and the same cores. Switch it on once the chain is up:"
    echo "      sudo systemctl enable --now electrs"
    echo
    echo "  Or have it done for you, together with the switch to Tor:"
    echo "      sudo bash 60-tor-automatic.sh"
    echo
    echo "  Indexing then takes roughly 1 to 3 days on a Pi 4. It is ready when"
    echo "  'finished full compaction' appears in: journalctl -u electrs -f"
    echo
fi
echo "  ------------------------------------------------------------------"
echo "  Enter in your wallet (BitBoxApp: Settings > Advanced settings >"
echo "  Connect your own full node):"
echo
echo "  At home on the LAN:"
echo "      ${LOCAL_IP}:${ELECTRS_PORT}"
if [[ -n "$ONION" ]]; then
    echo
    echo "  From outside (Tor, encrypted):"
    echo "      ${ONION}:${ELECTRS_PORT}"
fi
echo "  ------------------------------------------------------------------"
echo
echo "  What this buys you: your wallet asks only your own node for balances"
echo "  and history. No stranger's server learns which addresses belong"
echo "  together or belong to you."
echo
echo "  The dashboard shows the state of electrs from now on."
echo
