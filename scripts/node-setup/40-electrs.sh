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
#   --version 0.12.1   a different electrs version
#   --port 50001       a different port
#   --no-tor           do not set up onion access
#   --build-now        start even if the node is not fully synced yet
#   --rebuild          build electrs even if the wanted version is installed
#   --new-password     create a new electrs RPC password (restarts Bitcoin Core)
#                      even though the account exists and no known password fits
#   --yes              no questions
#
# On a machine that already runs electrs it keeps what is there: the index
# directory (db_dir), the RPC password, other values in config.toml. It builds
# only if the installed version is not the wanted one. It stops, instead of
# guessing, if db_dir or the password cannot be read, if the password does not
# fit the rpcauth line in bitcoin.conf, or if db_dir lies in Core's data
# directory.

set -euo pipefail

ELECTRS_VERSION="0.12.1"
WITH_TOR=1
FORCE=0
REBUILD=0
NEW_PASSWORD=0
ELECTRS_WAS_ACTIVE=0
ELECTRS_USER="electrs"
ELECTRS_PORT=50001
PORT_GIVEN=0
DB_DIR=""
DATADIR=""
SECRETS="/etc/bitcoin-access.conf"
ELECTRS_CONFIG="/etc/electrs/config.toml"
ELECTRS_UNIT="/etc/systemd/system/electrs.service"
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

# --- what an earlier run left behind ----------------------------------------

# The string value of KEY in a TOML file, without the quotes. Prints nothing
# if there is no such key. Status 3 if the line is there but not readable:
# "text" or 'text', optionally followed by a comment, nothing else. A caller
# that falls back to a default on an empty answer must test for the key first.
toml_get() {
    local out
    out="$(K="$2" awk '
        BEGIN { k = ENVIRON["K"]; sq = "\047" }
        $0 ~ ("^" k "[ \t]*=") {
            s = $0; sub(/^[^=]*=[ \t]*/, "", s)
            q = substr(s, 1, 1)
            if (q != "\"" && q != sq) { print "BAD"; exit }
            rest = substr(s, 2); n = index(rest, q)
            if (n == 0) { print "BAD"; exit }
            v = substr(rest, 1, n - 1); tail = substr(rest, n + 1)
            if (q == "\"" && index(v, "\\") > 0) { print "BAD"; exit }
            if (tail !~ /^[ \t\r]*(#.*)?$/) { print "BAD"; exit }
            print "V" v; exit
        }' "$1")"
    case "$out" in
        BAD) return 3 ;;
        V*)  printf '%s\n' "${out#V}" ;;
    esac
    return 0
}

# Sets KEY to VALUE (already quoted where TOML wants quotes). A line that
# already holds that value stays byte for byte as it is.
toml_set() {
    local file="$1" key="$2" value="$3" tmp
    tmp="$(mktemp)"
    K="$key" V="$value" awk '
        BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"] }
        $0 ~ ("^" k "[ \t]*=") {
            if (!done) {
                cur = $0; sub(/^[^=]*=[ \t]*/, "", cur); sub(/[ \t]+$/, "", cur)
                if (cur == v) print $0; else print k " = " v
            }
            done = 1; next
        }
        { print }
        END { if (!done) print k " = " v }' "$file" > "$tmp"
    cat "$tmp" > "$file"
    rm -f "$tmp"
}

# Makes KEY hold the string VALUE. A line that already holds it stays as it is,
# with its quotes and its comment; any other line is replaced.
toml_ensure() {
    local cur rc=0
    if grep -q "^${2}[[:space:]]*=" "$1"; then
        cur="$(toml_get "$1" "$2")" || rc=$?
        if (( rc == 0 )) && [[ "$cur" == "$3" ]]; then return 0; fi
    fi
    toml_set "$1" "$2" "\"$3\""
}

# Adds KEY only if the file has no such key. What is there is never changed.
toml_add() {
    if ! grep -q "^${2}[[:space:]]*=" "$1"; then
        [[ -z "$(tail -c1 "$1")" ]] || echo >> "$1"
        printf '%s = %s\n' "$2" "$3" >> "$1"
    fi
}

# The index directory electrs already uses, else DEFAULT. It lands in config.toml,
# in the unit and in a chown, so only plain path characters are accepted.
electrs_db_dir() {
    local v="" rc=0
    if [[ -f "$ELECTRS_CONFIG" ]] && grep -q '^db_dir[[:space:]]*=' "$ELECTRS_CONFIG"; then
        # The line is there. If it cannot be read, taking the default would
        # silently start a new index, for many hours.
        v="$(toml_get "$ELECTRS_CONFIG" db_dir)" || rc=$?
        if (( rc != 0 )) || [[ -z "$v" ]]; then
            red "  db_dir in $ELECTRS_CONFIG is there but not readable: $(grep -m1 '^db_dir' "$ELECTRS_CONFIG")" >&2
            red "  Write it as db_dir = \"/path\" and run this again. Nothing was changed." >&2
            return 1
        fi
    else
        printf '%s\n' "$1"
        return 0
    fi
    if [[ "$v" =~ ^/[A-Za-z0-9_./+-]+$ && "$v" != *..* ]]; then
        printf '%s\n' "$v"
        return 0
    fi
    red "  db_dir in $ELECTRS_CONFIG is not a plain path: $v" >&2
    return 1
}

# The index directory is given to electrs with chown -R, so it must not be
# Core's data directory, lie inside it, or contain it (/mnt/bitcoin, /).
db_dir_safe() {   # db_dir_safe DB_DIR DATADIR
    local d b
    d="$(realpath -m -- "$1" 2>/dev/null || printf '%s' "$1")"
    b="$(realpath -m -- "$2" 2>/dev/null || printf '%s' "$2")"
    d="${d%/}"; b="${b%/}"
    if [[ -z "$b" ]]; then
        red "  The data directory of Bitcoin Core is unknown; not touching $1." >&2
        return 1
    fi
    case "${d}/" in "${b}/"*) ;; *) case "${b}/" in "${d}/"*) ;; *) return 0 ;; esac ;; esac
    red "  db_dir $1 is, contains or lies in the data directory of Bitcoin Core ($2)." >&2
    red "  electrs would take ownership of it. Choose a directory of its own. Aborting." >&2
    return 1
}

# The older German scripts called the credentials file bitcoin-zugang.conf.
find_access_file() {   # find_access_file ETC
    local f
    for f in "$1/bitcoin-access.conf" "$1/bitcoin-zugang.conf"; do
        if [[ -f "$f" ]]; then printf '%s\n' "$f"; return 0; fi
    done
    return 1
}

# The password electrs already uses, from its config.toml (auth = "electrs:...").
# Status 3 if the auth line is there but cannot be read.
existing_electrs_pass() {
    local auth="" rc=0
    [[ -f "$ELECTRS_CONFIG" ]] || return 0
    auth="$(toml_get "$ELECTRS_CONFIG" auth)" || rc=$?
    (( rc == 0 )) || return "$rc"
    if [[ "$auth" == electrs:* ]]; then printf '%s\n' "${auth#electrs:}"; fi
    return 0
}

# The password is written between quotes, in config.toml and in the credentials
# file; generated ones are urlsafe. Anything else is not taken over.
password_chars_ok() {
    [[ "$1" =~ ^[A-Za-z0-9._~-]+$ ]]
}

# True if PASS is the password behind the rpcauth=electrs:SALT$HASH line of CONF,
# computed as rpcauth.py does it and as this script creates the line. The
# password goes in through the environment, not onto a command line.
rpcauth_matches() {   # rpcauth_matches CONF PASS
    local line
    line="$(sed -n 's/^rpcauth=electrs:\(.*\)$/\1/p' "$1" | head -1)"
    [[ "$line" == *'$'* && -n "$2" ]] || return 1
    RPC_SALT="${line%%\$*}" RPC_HASH="${line#*\$}" RPC_PASS="$2" python3 -c '
import hashlib, hmac, os, sys
mac = hmac.new(os.environ["RPC_SALT"].encode(), os.environ["RPC_PASS"].encode(), hashlib.sha256).hexdigest()
sys.exit(0 if hmac.compare_digest(mac, os.environ["RPC_HASH"].strip()) else 1)'
}

# Whether the account electrs uses can be taken over. The credentials file and
# config.toml each offer a password; the one that fits the rpcauth line in
# bitcoin.conf is used and put in ELECTRS_PASS. Nothing is generated, and Core
# is not touched. Status:
#   0  taken over
#   1  no rpcauth=electrs line yet: an account has to be created
#   2  the account exists, but no known password fits it
#   3  the account exists, and the auth line in config.toml cannot be read
reuse_electrs_access() {
    local cfg="" rc=0 p cands=()
    grep -q '^rpcauth=electrs:' "$BTC_CONF" 2>/dev/null || return 1
    cfg="$(existing_electrs_pass)" || rc=$?
    [[ -z "${ELECTRS_PASS:-}" ]] || cands+=("$ELECTRS_PASS")
    [[ -z "$cfg" ]] || cands+=("$cfg")
    if (( ${#cands[@]} == 0 )); then
        if (( rc == 3 )); then return 3; fi
        return 2
    fi
    for p in "${cands[@]}"; do
        if password_chars_ok "$p" && rpcauth_matches "$BTC_CONF" "$p"; then
            ELECTRS_PASS="$p"
            return 0
        fi
    done
    return 2
}

# Takes the account over, or creates it. Only creating one restarts Core.
ensure_electrs_access() {
    local rc=0 PAIR
    reuse_electrs_access || rc=$?
    case "$rc" in
        0)  remember_electrs_access
            ok "account already exists, its password is kept (it fits the rpcauth line)"
            return 0 ;;
        1)  ;;
        *)  if (( NEW_PASSWORD == 0 )); then
                red "  bitcoin.conf has an rpcauth=electrs line, but no password this script can" >&2
                red "  find fits it (the credentials file and the auth line in $ELECTRS_CONFIG)." >&2
                red "  Nothing was changed. To create a new password, which replaces the rpcauth" >&2
                red "  line and restarts Bitcoin Core, run again with --new-password." >&2
                return 1
            fi
            warn "--new-password: the existing account gets a new password" ;;
    esac

    PAIR="$(python3 - <<'PY'
import hashlib, hmac, os, secrets
pw = secrets.token_urlsafe(32); salt = os.urandom(16).hex()
print(f"electrs:{salt}${hmac.new(salt.encode(), pw.encode(), hashlib.sha256).hexdigest()}")
print(pw)
PY
)"
    ELECTRS_RPCAUTH="$(sed -n 1p <<<"$PAIR" | tr -d '\r')"
    ELECTRS_PASS="$(sed -n 2p <<<"$PAIR" | tr -d '\r')"

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
    systemctl is-active --quiet bitcoind || { red "  Bitcoin Core no longer starts."; return 1; }
    ok "Bitcoin Core is running again"
}

# Puts what was taken over into the credentials file, where the other scripts
# look for it. Lines that are there stay.
remember_electrs_access() {
    local rpcauth
    if ! grep -q '^ELECTRS_PASS=' "$SECRETS"; then
        printf "ELECTRS_PASS='%s'\n" "$ELECTRS_PASS" >> "$SECRETS"
    fi
    if ! grep -q '^ELECTRS_RPCAUTH=' "$SECRETS"; then
        rpcauth="$(sed -n 's/^rpcauth=\(electrs:.*\)$/\1/p' "$BTC_CONF" | head -1)"
        if [[ -n "$rpcauth" ]]; then printf "ELECTRS_RPCAUTH='%s'\n" "$rpcauth" >> "$SECRETS"; fi
    fi
    chmod 600 "$SECRETS"
}

# True if BIN reports exactly the wanted version.
electrs_is_current() {   # electrs_is_current BIN VERSION
    local out
    [[ -x "$1" ]] || return 1
    out="$("$1" --version 2>&1 || true)"
    grep -qE "(^|[^0-9.])${2//./\\.}([^0-9.]|\$)" <<<"$out"
}

# True if electrs has to be built: it is forced, or BIN is not the wanted version.
need_build() {   # need_build BIN VERSION REBUILD
    [[ "$3" == 1 ]] && return 0
    if electrs_is_current "$1" "$2"; then return 1; fi
    return 0
}

# getblockchaininfo from the node. The sudo user may have no
# ~/.bitcoin/bitcoin.conf (a second admin, for instance), so: first as that
# user, then with the node's own cookie, then with the admin account from the
# credentials file. The password goes in through stdin, never onto a command
# line where ps could show it.
chain_info() {   # chain_info USER DATADIR
    local out
    out="$(sudo -u "$1" bitcoin-cli getblockchaininfo 2>/dev/null || true)"
    if [[ -z "$out" ]]; then
        out="$(bitcoin-cli -datadir="$2" getblockchaininfo 2>/dev/null || true)"
    fi
    if [[ -z "$out" && -n "${ADMIN_USER_RPC:-}" && -n "${ADMIN_PASS:-}" ]]; then
        out="$(printf '%s\n' "$ADMIN_PASS" | bitcoin-cli -rpcuser="$ADMIN_USER_RPC" \
            -stdinrpcpass getblockchaininfo 2>/dev/null || true)"
    fi
    printf '%s' "$out"
}

# The service account. An existing one gets the index directory as its home as
# well, so that no place still names another directory. Only the account
# entry changes, no file is moved.
ensure_electrs_user() {
    local home
    if ! id -u "$ELECTRS_USER" >/dev/null 2>&1; then
        useradd --system --shell /usr/sbin/nologin --home-dir "$DB_DIR" --no-create-home "$ELECTRS_USER"
        ok "service user '$ELECTRS_USER' created"
        return 0
    fi
    home="$(getent passwd "$ELECTRS_USER" | cut -d: -f6)"
    [[ "$home" != "$DB_DIR" ]] || return 0
    # usermod refuses to change the home of an account that has running
    # processes, so it is not even tried while electrs runs. The service does
    # not use the home (its paths come from the unit), nothing breaks.
    if (( ${ELECTRS_WAS_ACTIVE:-0} == 1 )); then
        warn "home of '$ELECTRS_USER' stays $home while electrs runs (usermod refuses)"
        info "to set it to $DB_DIR later: stop electrs, run"
        info "    usermod --home $DB_DIR $ELECTRS_USER"
        info "and start electrs again"
        return 0
    fi
    if usermod --home "$DB_DIR" "$ELECTRS_USER"; then
        ok "home of '$ELECTRS_USER' changed from $home to $DB_DIR (account entry only)"
    else
        warn "home of '$ELECTRS_USER' is $home, not $DB_DIR; could not change it"
    fi
    return 0
}

prepare_db_dir() {
    db_dir_safe "$DB_DIR" "$DATADIR" || return 1
    mkdir -p "$DB_DIR"
    chown -R "${ELECTRS_USER}:${ELECTRS_USER}" "$DB_DIR"
    chmod 750 "$DB_DIR"
}

# A new machine gets the whole file. An existing one keeps every value it has:
# only db_dir and auth are set (they carry what was decided above), keys that
# are missing are added, and the file is backed up only if something changed.
write_electrs_config() {
    local new="${WORK}/config.toml.new"
    if [[ ! -f "$ELECTRS_CONFIG" ]]; then
        cat > "$ELECTRS_CONFIG" <<EOF
# electrs — Electrum server for your own wallet
network = "bitcoin"
db_dir = "${DB_DIR}"
daemon_dir = "${DATADIR}"
daemon_rpc_addr = "127.0.0.1:8332"
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
        return 0
    fi
    cp "$ELECTRS_CONFIG" "$new"
    toml_ensure "$new" db_dir "${DB_DIR}"
    toml_ensure "$new" auth "electrs:${ELECTRS_PASS}"
    if (( PORT_GIVEN == 1 )); then toml_ensure "$new" electrum_rpc_addr "127.0.0.1:${ELECTRS_PORT}"; fi
    toml_add "$new" network '"bitcoin"'
    toml_add "$new" daemon_dir "\"${DATADIR}\""
    toml_add "$new" daemon_rpc_addr '"127.0.0.1:8332"'
    toml_add "$new" electrum_rpc_addr "\"127.0.0.1:${ELECTRS_PORT}\""
    toml_add "$new" monitoring_addr '"127.0.0.1:4224"'
    toml_add "$new" log_filters '"INFO"'
    toml_add "$new" index_lookup_limit 200
    toml_add "$new" server_banner "\"$(hostname) — private node\""
    if ! cmp -s "$new" "$ELECTRS_CONFIG"; then
        cp -p "$ELECTRS_CONFIG" "${ELECTRS_CONFIG}.backup.$(date +%Y%m%d-%H%M%S)"
        cat "$new" > "$ELECTRS_CONFIG"
        info "existing config.toml updated, the old one kept as ${ELECTRS_CONFIG}.backup.*"
    else
        info "existing config.toml needs no change"
    fi
    rm -f "$new"
}

write_electrs_unit() {
    cat > "$ELECTRS_UNIT" <<EOF
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
# electrs 0.12 keeps many RocksDB files open; the default soft limit of
# 1024 makes it crash with "Too many open files" once the index is built.
LimitNOFILE=65536

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
}

# A fingerprint of what electrs would start with: config.toml, and the unit as
# systemd has merged it with its drop-in files. Taken before and after the files
# are written, it says whether a restart changes anything. The text of the unit
# is not compared (a new description or another order of paths is no reason to
# restart): list values are compared as sets.
electrs_state_sum() {
    local K V
    {
        cat "$ELECTRS_CONFIG" 2>/dev/null
        systemctl show electrs -p User -p Group -p SupplementaryGroups -p LimitNOFILE \
            -p ReadWritePaths -p ReadOnlyPaths 2>/dev/null | sort | {
            while IFS='=' read -r K V; do
                printf '%s=' "$K"
                tr ' ' '\n' <<<"$V" | sort -u | tr '\n' ' '
                echo
            done
        }
    } | cksum
}

# Restarts electrs only if it was running and what it starts with has changed.
# enable --now starts a stopped service but leaves a running one as it is, so a
# changed config or unit only takes effect after a restart. If nothing changed,
# nothing restarts: electrs is slow for a while after every start.
restart_electrs_if_changed() {
    if (( ELECTRS_WAS_ACTIVE == 1 )) && [[ "$STATE_AFTER" != "$STATE_BEFORE" ]]; then
        info "configuration or unit changed, restarting electrs ..."
        systemctl restart electrs
    fi
    return 0
}

# Adds the onion service to TORRC unless it is there. Status 0 if the file
# changed, 1 if there was nothing to do.
add_onion_to_torrc() {   # add_onion_to_torrc TORRC PORT
    if grep -q 'HiddenServiceDir /var/lib/tor/electrs' "$1" 2>/dev/null; then return 1; fi
    cat >> "$1" <<EOF

# Electrum server for your wallet
HiddenServiceDir /var/lib/tor/electrs/
HiddenServicePort ${2} 127.0.0.1:${2}
EOF
    return 0
}

# A running Tor with the service already configured is not restarted: that
# would cut every onion connection of the node for a moment.
tor_needs_restart() {   # tor_needs_restart TORRC_CHANGED(0|1)
    [[ "$1" == 1 ]] && return 0
    if systemctl is-active --quiet tor; then return 1; fi
    return 0
}

# True if exactly one firewall rule allows PORT/tcp from SUBNET with the comment
# MARK. A rule that is already right is left alone: replacing it would leave a
# moment without it.
ufw_rule_present() {   # ufw_rule_present SUBNET PORT MARK
    local n
    n="$(ufw status numbered 2>/dev/null \
        | grep -cE "^\[ *[0-9]+\] +${2}/tcp +ALLOW IN +${1//./\\.} +# ${3}[[:space:]]*\$" || true)"
    [[ "$n" == 1 ]]
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --version)      ELECTRS_VERSION="${2:-}"; shift 2 ;;
            --port)         ELECTRS_PORT="${2:-}"; PORT_GIVEN=1; shift 2 ;;
            --no-tor)       WITH_TOR=0; shift ;;
            --build-now)    FORCE=1; shift ;;
            --rebuild)      REBUILD=1; shift ;;
            --new-password) NEW_PASSWORD=1; shift ;;
            --yes)          ASSUME_YES=1; shift ;;
            -h|--help)      sed -n '2,31p' "$0"; exit 0 ;;
            *) red "Unknown option: $1"; exit 1 ;;
        esac
    done
}
parse_args "$@"

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

SECRETS="$(find_access_file /etc)" \
    || { red "  /etc/bitcoin-access.conf missing. Please run 30-bitcoin-core.sh first."; exit 1; }
[[ "$SECRETS" == /etc/bitcoin-access.conf ]] || info "using the credentials file of the older setup: $SECRETS"
# shellcheck disable=SC1090
. "$SECRETS"

systemctl is-active --quiet bitcoind || { red "  Bitcoin Core is not running."; exit 1; }
ok "Bitcoin Core is running"

DATADIR="$(awk -F'-datadir=' '/ExecStart/ {split($2,a," "); print a[1]}' \
    /etc/systemd/system/bitcoind.service 2>/dev/null || true)"
[[ -n "$DATADIR" ]] || DATADIR="/mnt/bitcoin/bitcoin"
BASE="$(dirname "$DATADIR")"
# An index that already exists stays where it is; a different directory would
# mean building it again, for many hours.
DB_DIR="$(electrs_db_dir "${BASE}/electrs")" || exit 1
db_dir_safe "$DB_DIR" "$DATADIR" || exit 1
ok "Bitcoin data: $DATADIR"
if [[ "$DB_DIR" == "${BASE}/electrs" ]]; then
    ok "Electrum index: $DB_DIR"
else
    ok "Electrum index: $DB_DIR (taken from $ELECTRS_CONFIG)"
fi
ELECTRS_WAS_ACTIVE=0
if systemctl is-active --quiet electrs 2>/dev/null; then ELECTRS_WAS_ACTIVE=1; fi

# An existing electrs listens where it listens, unless --port says otherwise.
if (( PORT_GIVEN == 0 )) && [[ -f "$ELECTRS_CONFIG" ]]; then
    PORT_ADDR="$(toml_get "$ELECTRS_CONFIG" electrum_rpc_addr)" \
        || { red "  electrum_rpc_addr in $ELECTRS_CONFIG is not readable. Nothing was changed."; exit 1; }
    PORT_FOUND="$(sed -n 's/.*:\([0-9][0-9]*\)$/\1/p' <<<"$PORT_ADDR")"
    [[ -z "$PORT_FOUND" ]] || ELECTRS_PORT="$PORT_FOUND"
fi

# --- pruning rules this out -------------------------------------------------
CHAIN="$(chain_info "$ADMIN_USER" "$DATADIR")"
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

# Nothing to build if the wanted version is already installed.
NEED_BUILD=0
if need_build /usr/local/bin/electrs "$ELECTRS_VERSION" "$REBUILD"; then
    NEED_BUILD=1
else
    ok "electrs ${ELECTRS_VERSION} is already installed, not building it again (--rebuild forces it)"
fi

# The next three parts (tooling, source, build) run only if there is something
# to build. They are not indented, to keep the diff small.
if (( NEED_BUILD == 1 )); then
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
        ok "librocksdb-dev ${ROCKS_VER}, will be linked dynamically"
    else
        warn "librocksdb-dev ${ROCKS_VER} does not match electrs ${ELECTRS_VERSION} (expects 9.10.0)"
        warn "Building statically instead, which takes longer."
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
        yellow "  That need not mean anything bad; the key may simply be missing."
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
[[ -x "$BINARY" ]] || { red "  build failed, no executable was produced."; exit 1; }
install -m 0755 -o root -g root "$BINARY" /usr/local/bin/electrs
ok "electrs installed in /usr/local/bin"
/usr/local/bin/electrs --version | sed 's/^/  /'
fi   # end of the build

# ======================================================= Access to the node ==
title "Access to Bitcoin Core"

BTC_CONF="${DATADIR}/bitcoin.conf"

# The account is taken over if the password fits its rpcauth line. Only a new
# account is created, and only that restarts Core.
ensure_electrs_access || exit 1

# ================================================================ Setting up =
title "Setting up electrs"

ensure_electrs_user
prepare_db_dir || exit 1

mkdir -p /etc/electrs
STATE_BEFORE="$(electrs_state_sum)"
umask 077
write_electrs_config
chown root:"$ELECTRS_USER" "$ELECTRS_CONFIG"
chmod 640 "$ELECTRS_CONFIG"
ok "configuration in $ELECTRS_CONFIG"

# electrs reads the block files directly; that needs group read on the data dir
usermod -aG bitcoin "$ELECTRS_USER"
chmod 750 "$DATADIR"
ok "read access to the block files granted"

write_electrs_unit

systemctl daemon-reload
STATE_AFTER="$(electrs_state_sum)"

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
    restart_electrs_if_changed
    sleep 8
    if systemctl is-active --quiet electrs; then
        ok "electrs is running and starting to index"
    else
        red "  start failed:"
        journalctl -u electrs -n 30 --no-pager | sed 's/^/    /'
        exit 1
    fi
else
    warn "electrs is installed but NOT started, the chain is not up yet"
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
command -v socat >/dev/null 2>&1 || apt-get install -y -qq socat >/dev/null
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
if ufw_rule_present "$SUBNET" "$ELECTRS_PORT" "$UFW_MARK"; then
    ok "firewall: port ${ELECTRS_PORT} from ${SUBNET} only (the rule is already there)"
else
    while :; do
        NR="$(ufw status numbered 2>/dev/null | grep -E "# ${UFW_MARK}[[:space:]]*\$" \
              | head -1 | tr -d '[]' | awk '{print $1}')"
        [[ "$NR" =~ ^[0-9]+$ ]] || break
        ufw --force delete "$NR" >/dev/null 2>&1 || break
    done
    ufw allow from "$SUBNET" to any port "$ELECTRS_PORT" proto tcp comment "$UFW_MARK" >/dev/null
    ok "firewall: port ${ELECTRS_PORT} from ${SUBNET} only"
fi

# ======================================================================= Tor =
ONION=""
if (( WITH_TOR == 1 )); then
    title "Tor access from outside"
    # An installed package is left alone: apt-get install would also upgrade it.
    dpkg -s tor >/dev/null 2>&1 || apt-get install -y -qq tor >/dev/null
    TOR_CHANGED=0
    if add_onion_to_torrc /etc/tor/torrc "$ELECTRS_PORT"; then TOR_CHANGED=1; fi
    if tor_needs_restart "$TOR_CHANGED"; then
        systemctl restart tor
        sleep 8
    fi

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
        warn "onion address not generated yet. Look later at:"
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
