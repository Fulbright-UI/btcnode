#!/usr/bin/env bash
#
# tests/existing-node-test.sh — setup scripts 30 and 40 on a node that exists.
#
# The scripts were written for a fresh machine. On a node that has been
# running for months they would rewrite bitcoin.conf, reset the firewall,
# possibly switch pruning on, and point electrs at a different index. This
# file runs them against stand-ins to prove they do not.
#
# Script 30 is executed for real, from a copy with its absolute paths moved
# below a temporary directory; systemctl, ufw, apt-get, curl, git and gpg are
# stand-ins on PATH that log every call. Script 40 is too big to run that way
# (it builds electrs), so its functions are cut out of the file and called with
# stand-ins for useradd, usermod, chown and bitcoin-cli.
#
# Nothing outside a temporary directory is touched. Needs no root.
#
# Usage:  bash tests/existing-node-test.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$(dirname "$HERE")"
S30="${PROJECT}/30-bitcoin-core.sh"
S40="${PROJECT}/40-electrs.sh"

FAILURES=0
title() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
check() {
    if [[ "$1" == "0" ]]; then
        printf '  \033[32m[ ok ]\033[0m %s\n' "$2"
    else
        printf '  \033[31m[FAIL]\033[0m %s\n' "$2"
        [[ -n "${3:-}" ]] && printf '         %s\n' "$3"
        FAILURES=$(( FAILURES + 1 ))
    fi
}
# check_not: passes when the command given as the last arguments FAILS
no() { ! "$@"; }

BOX="$(mktemp -d)"
trap 'rm -rf "$BOX"' EXIT

# ============================================================ test fixtures ==
# One release archive that every sandbox serves, named as the script expects.
case "$(uname -m)" in
    aarch64) ARCH="aarch64-linux-gnu" ;;
    *)       ARCH="x86_64-linux-gnu" ;;
esac
VERSION="32.1"
FIX="${BOX}/fixtures"
mkdir -p "${FIX}/bitcoin-${VERSION}/bin"
for B in bitcoind bitcoin-cli bitcoin-qt test_bitcoin; do
    printf '#!/usr/bin/env bash\necho "Bitcoin Core daemon version v%s.0 (new)"\n' "$VERSION" \
        > "${FIX}/bitcoin-${VERSION}/bin/${B}"
    chmod +x "${FIX}/bitcoin-${VERSION}/bin/${B}"
done
tar -czf "${FIX}/bitcoin-${VERSION}-${ARCH}.tar.gz" -C "$FIX" "bitcoin-${VERSION}"
( cd "$FIX" && sha256sum "bitcoin-${VERSION}-${ARCH}.tar.gz" > SHA256SUMS && : > SHA256SUMS.asc )

# --------------------------------------------------------------- sandbox ----
# Everything the script would touch is rebuilt below $SB: the old binaries,
# the service file, the configuration, and the list of running units.
GOOD_SIGS=$'gpg: Good signature from "A"\ngpg: Good signature from "B"\ngpg: Good signature from "C"\ngpg: Good signature from "D"'

make_sandbox() {   # make_sandbox NAME [node|empty]
    SB="${BOX}/$1"
    mkdir -p "$SB"/{etc/systemd/system,usr/local/bin,usr/local/lib,data/bitcoin,state,stubs,fixtures}
    cp "$FIX"/* "$SB/fixtures/" 2>/dev/null
    cp -r "$FIX/bitcoin-${VERSION}" "$SB/fixtures/" 2>/dev/null
    : > "$SB/calls.log"
    printf '%s\n' "$GOOD_SIGS" > "$SB/gpg-verify"

    # The copy under test: no root check, every absolute path moved below $SB.
    sed -e 's|^\[\[ \$EUID -eq 0 \]\].*$|true|' \
        -e "s|/usr/local/|${SB}/usr/local/|g" \
        -e "s|/etc/|${SB}/etc/|g" -e "s|/etc \"|${SB}/etc \"|g" \
        "$S30" > "$SB/30.sh"

    # Stand-ins. All of them log, none of them do anything.
    local N
    for N in apt-get ufw sysctl chattr swapon mkswap fallocate findmnt mount journalctl \
             useradd usermod sshd fail2ban-client sleep; do
        printf '#!/usr/bin/env bash\necho "%s $*" >> "$SB/calls.log"\nexit 0\n' "$N" > "$SB/stubs/$N"
    done
    printf '#!/usr/bin/env bash\nexit 1\n' > "$SB/stubs/mountpoint"
    cat > "$SB/stubs/systemctl" <<'EOF'
#!/usr/bin/env bash
echo "systemctl $*" >> "$SB/calls.log"
case "$1" in
    is-active) shift; [[ "${1:-}" == --quiet ]] && shift; [[ -e "$SB/state/$1" ]] ;;
    stop)  rm -f "$SB/state/$2"
           # Requires=bitcoind takes electrs and its LAN forwarder down with it.
           [[ "$2" == bitcoind ]] && rm -f "$SB/state/electrs" "$SB/state/electrs-lan"
           exit 0 ;;
    start) : > "$SB/state/$2" ;;
    *)     exit 0 ;;
esac
EOF
    cat > "$SB/stubs/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >> "$SB/calls.log"
for A in "$@"; do LAST="$A"; done
cp "$SB/fixtures/$(basename "$LAST")" .
EOF
    cat > "$SB/stubs/git" <<'EOF'
#!/usr/bin/env bash
echo "git $*" >> "$SB/calls.log"
for A in "$@"; do LAST="$A"; done
mkdir -p "$LAST/builder-keys"; echo key > "$LAST/builder-keys/a.gpg"
EOF
    cat > "$SB/stubs/gpg" <<'EOF'
#!/usr/bin/env bash
echo "gpg $*" >> "$SB/calls.log"
case "$*" in
    *--verify*)     cat "$SB/gpg-verify" ;;
    *--list-keys*)  echo "pub:u:255:22:ABCDEF:1:::::" ;;
esac
exit 0
EOF
    local REAL_INSTALL; REAL_INSTALL="$(command -v install)"
    cat > "$SB/stubs/install" <<EOF
#!/usr/bin/env bash
# The real install, minus the ownership options only root may use.
ARGS=()
while [[ \$# -gt 0 ]]; do
    case "\$1" in -o|-g) shift 2 ;; *) ARGS+=("\$1"); shift ;; esac
done
exec "$REAL_INSTALL" "\${ARGS[@]}"
EOF
    chmod +x "$SB"/stubs/*

    if [[ "${2:-node}" == "node" ]]; then
        # What an older setup left behind.
        printf 'dbcache=300\nrpcauth=electrs:salt$hash\nblockfilterindex=1\n' > "$SB/data/bitcoin/bitcoin.conf"
        printf 'UNIT-ORIGINAL\n' > "$SB/etc/systemd/system/bitcoind.service"
        printf "ADMIN_PASS='x'\n" > "$SB/etc/bitcoin-zugang.conf"
        printf '#!/usr/bin/env bash\necho "Bitcoin Core daemon version v31.3.0 (old)"\n' > "$SB/usr/local/bin/bitcoind"
        cp "$SB/usr/local/bin/bitcoind" "$SB/usr/local/bin/bitcoin-cli"
        chmod +x "$SB/usr/local/bin/"*
        : > "$SB/state/bitcoind"; : > "$SB/state/electrs"; : > "$SB/state/electrs-lan"
    fi
}

run30() {   # run30 ARGS... — runs the copy, output in $SB/out, status in $RC
    ( cd "$SB" && SB="$SB" PATH="${SB}/stubs:${PATH}" \
        bash "$SB/30.sh" --datadir "${SB}/data/bitcoin" "$@" > "$SB/out" 2>&1 < /dev/null )
    RC=$?
}
node_sum() { ( cd "$SB" && cat data/bitcoin/bitcoin.conf etc/systemd/system/bitcoind.service etc/bitcoin-zugang.conf | cksum ); }
called()   { grep -qE "$1" "$SB/calls.log"; }
LOGSHORT() { head -c 300 "$SB/out" | tr '\n' ' '; }

# ===================================================== 30: existing node ====
title "30: an existing node is recognised (P1)"

# shellcheck disable=SC1090
load_fn() {   # load_fn FILE NAME — define one function out of a script
    local SRC
    SRC="$(awk -v n="$2" 'index($0, n "() {") == 1 { p = 1 } p { print } p && /^}/ { exit }' "$1")"
    if [[ -z "$SRC" ]]; then
        check 1 "$(basename "$1") defines $2()"
        return 1
    fi
    eval "$SRC"
}
red() { echo "$*"; }; yellow() { echo "$*"; }; green() { echo "$*"; }
ok() { echo "ok $*"; }; info() { echo "info $*"; }; warn() { echo "warn $*"; }

if load_fn "$S30" find_existing_node; then
    E="${BOX}/p1"; mkdir -p "$E"/{etc/systemd/system,data}
    find_existing_node "$E/data" "$E/etc" >/dev/null
    check $(( $? == 0 ? 1 : 0 )) "an empty machine is not an existing node"
    : > "$E/data/bitcoin.conf"
    find_existing_node "$E/data" "$E/etc" >/dev/null; check $? "bitcoin.conf in the data directory"
    rm "$E/data/bitcoin.conf"; : > "$E/etc/systemd/system/bitcoind.service"
    find_existing_node "$E/data" "$E/etc" >/dev/null; check $? "bitcoind.service"
    rm "$E/etc/systemd/system/bitcoind.service"; : > "$E/etc/bitcoin-access.conf"
    find_existing_node "$E/data" "$E/etc" >/dev/null; check $? "/etc/bitcoin-access.conf"
    rm "$E/etc/bitcoin-access.conf"; : > "$E/etc/bitcoin-zugang.conf"
    find_existing_node "$E/data" "$E/etc" >/dev/null; check $? "/etc/bitcoin-zugang.conf (the old German name)"
fi

title "30: without --upgrade-existing the script stops (P2)"
make_sandbox p2
BEFORE="$(node_sum)"
run30 --yes
check $(( RC != 0 ? 0 : 1 )) "exit status is not 0" "status $RC"
grep -q -- '--upgrade-existing' "$SB/out"
check $? "the message names the switch" "$(LOGSHORT)"
no called '^(ufw|apt-get|useradd|usermod|sysctl|swapon) '
check $? "no ufw, apt-get, user, sysctl or swap call"
no called 'systemctl (stop|start|restart|enable|daemon-reload)'
check $? "no service touched" "$(grep systemctl "$SB/calls.log" | head -3 | tr '\n' ';')"
[[ "$(node_sum)" == "$BEFORE" ]]
check $? "bitcoin.conf, service file and credentials unchanged"
[[ "$("${SB}/usr/local/bin/bitcoind" --version)" == *old* ]]
check $? "binaries unchanged"

title "30: --upgrade-existing swaps the binaries and nothing else (P3)"
make_sandbox p3
BEFORE="$(node_sum)"
run30 --upgrade-existing --yes
check $(( RC == 0 ? 0 : 1 )) "exit status 0" "status $RC: $(LOGSHORT)"
[[ "$("${SB}/usr/local/bin/bitcoind" --version 2>/dev/null)" == *"v32.1.0 (new)"* ]]
check $? "bitcoind is the new version"
[[ ! -e "${SB}/usr/local/bin/bitcoin-qt" && ! -e "${SB}/usr/local/bin/test_bitcoin" ]]
check $? "bitcoin-qt and test_bitcoin are not installed"
[[ -x "${SB}/usr/local/lib/btcnode/bitcoin-core-31.3/bitcoind" ]]
check $? "the old binaries are kept in /usr/local/lib/btcnode/bitcoin-core-<old>"
called 'systemctl stop bitcoind' && called 'systemctl start bitcoind'
check $? "bitcoind stopped and started again"
[[ -e "$SB/state/bitcoind" && -e "$SB/state/electrs" && -e "$SB/state/electrs-lan" ]]
check $? "electrs and electrs-lan, taken down by Requires=, run again"
no called '^ufw '
check $? "ufw is not called (no reset, no rule)"
no called '^(apt-get|useradd|usermod|sysctl|swapon|mkswap|fallocate) '
check $? "no package, user, sysctl or swap change"
no called 'systemctl (enable|daemon-reload|restart)'
check $? "no unit enabled or reloaded"
[[ "$(node_sum)" == "$BEFORE" ]]
check $? "bitcoin.conf, service file and credentials byte-identical"
no grep -q '^prune=' "$SB/data/bitcoin/bitcoin.conf"
check $? "no prune= in bitcoin.conf"
FIRST_STOP="$(grep -n 'systemctl stop bitcoind' "$SB/calls.log" | head -1 | cut -d: -f1)"
LAST_CHECK="$(grep -n '^gpg .*--verify' "$SB/calls.log" | tail -1 | cut -d: -f1)"
[[ -n "$FIRST_STOP" && -n "$LAST_CHECK" && "$LAST_CHECK" -lt "$FIRST_STOP" ]]
check $? "the node is stopped only after the signatures were checked"

title "30: --upgrade-existing refuses what it cannot do safely (P4)"
make_sandbox p4a empty
run30 --upgrade-existing --yes
check $(( RC != 0 ? 0 : 1 )) "no existing node: refused" "status $RC"
no called 'systemctl (stop|start)'
check $? "no existing node: nothing touched"
make_sandbox p4b
run30 --upgrade-existing --prune 600000
check $(( RC != 0 ? 0 : 1 )) "with --prune: refused" "status $RC"
make_sandbox p4c
run30 --upgrade-existing --tor
check $(( RC != 0 ? 0 : 1 )) "with --tor: refused" "status $RC"
no called 'systemctl stop'
check $? "with --prune or --tor the node keeps running"

title "30: a bad signature leaves the node alone (P5)"
make_sandbox p5
printf 'gpg: BAD signature from "X"\n' > "$SB/gpg-verify"
BEFORE="$(node_sum)"
run30 --upgrade-existing --yes
check $(( RC != 0 ? 0 : 1 )) "exit status is not 0" "status $RC"
no called 'systemctl stop'
check $? "bitcoind was not stopped"
[[ "$("${SB}/usr/local/bin/bitcoind" --version)" == *old* && "$(node_sum)" == "$BEFORE" ]]
check $? "binaries and configuration unchanged"

title "30: --yes never switches pruning on (P6)"
if load_fn "$S30" decide_pruning; then
    run_prune() {   # run_prune FREE_GB PRUNE_MB ASSUME_YES INTERACTIVE [ANSWER]
        FREE_GB="$1"; PRUNE_MB="$2"; ASSUME_YES="$3"; INTERACTIVE="$4"
        decide_pruning <<<"${5:-}" >/dev/null
    }
    run_prune 826 0 1 0;  check $(( PRUNE_MB == 0 ? 0 : 1 )) "--yes on a full node with 826 GB free: no pruning (was 726000)"
    run_prune 826 0 1 1;  check $(( PRUNE_MB == 0 ? 0 : 1 )) "--yes at a terminal: no pruning"
    run_prune 826 0 0 0;  check $(( PRUNE_MB == 0 ? 0 : 1 )) "piped without --yes: no pruning"
    run_prune 826 0 0 1 y; check $(( PRUNE_MB == 726000 ? 0 : 1 )) "typed 'y' at a terminal: pruning as suggested" "got $PRUNE_MB"
    run_prune 826 0 0 1 n; check $(( PRUNE_MB == 0 ? 0 : 1 )) "typed 'n' at a terminal: no pruning"
    run_prune 826 600000 1 0; check $(( PRUNE_MB == 600000 ? 0 : 1 )) "--prune 600000 is kept"
fi
grep -qF -- '--upgrade-existing' "$S30"
check $? "the header documents --upgrade-existing"

# ================================================================ 40 =======
# Functions out of 40-electrs.sh, run against files in a temp directory.
title "40: loading the functions"
for F in toml_get toml_set toml_add electrs_db_dir existing_electrs_pass find_access_file \
         reuse_electrs_access remember_electrs_access electrs_is_current chain_info \
         ensure_electrs_user prepare_db_dir write_electrs_config write_electrs_unit \
         electrs_state_sum; do
    load_fn "$S40" "$F" && check 0 "40-electrs.sh defines $F()"
done

E="${BOX}/e"
BASE="${E}/mnt/bitcoin"
DATADIR="${BASE}/bitcoin"
DEFAULT_DB="${BASE}/electrs"
NEW_DB="${BASE}/electrs-0.12"
ELECTRS_CONFIG="${E}/etc/electrs/config.toml"
ELECTRS_UNIT="${E}/etc/systemd/system/electrs.service"
ELECTRS_USER="electrs"
ELECTRS_PORT=50001
PORT_GIVEN=0
WORK="${BOX}/work"
mkdir -p "$(dirname "$ELECTRS_CONFIG")" "$(dirname "$ELECTRS_UNIT")" "$DATADIR" "$WORK"
LOG="${BOX}/e.log"; : > "$LOG"

# Stand-ins as shell functions: they shadow the real commands in this shell.
id()      { [[ "${1:-}" == "-u" ]] && [[ "${USER_EXISTS:-0}" == "1" ]]; }
getent()  { echo "electrs:x:996:983::${USER_HOME:-/nonexistent}:/usr/sbin/nologin"; }
useradd() { echo "useradd $*" >> "$LOG"; }
usermod() { echo "usermod $*" >> "$LOG"; }
chown()   { echo "chown $*" >> "$LOG"; }
hostname(){ echo "btcnode"; }

# The config.toml of the running node, as the older script wrote it.
node_config() {
cat > "$ELECTRS_CONFIG" <<EOF
# electrs — Electrum-Server fuer die BitBoxApp
network = "bitcoin"
db_dir = "${NEW_DB}"
daemon_dir = "${DATADIR}"
daemon_rpc_addr = "127.0.0.1:8332"
auth = "electrs:oldPassw0rd_-x"

# Nur lokal lauschen.
electrum_rpc_addr = "127.0.0.1:50001"

monitoring_addr = "127.0.0.1:4224"

log_filters = "INFO"
index_lookup_limit = 200
server_banner = "btcnode — privater Node"
EOF
}

title "40: db_dir comes from the running configuration (P7)"
rm -f "$ELECTRS_CONFIG"
[[ "$(electrs_db_dir "$DEFAULT_DB" 2>/dev/null)" == "$DEFAULT_DB" ]]
check $? "no config.toml: the default"
node_config
[[ "$(electrs_db_dir "$DEFAULT_DB" 2>/dev/null)" == "$NEW_DB" ]]
check $? "config.toml names electrs-0.12: that one" "got $(electrs_db_dir "$DEFAULT_DB" 2>&1)"
sed -i '/^db_dir/d' "$ELECTRS_CONFIG"
[[ "$(electrs_db_dir "$DEFAULT_DB" 2>/dev/null)" == "$DEFAULT_DB" ]]
check $? "config.toml without db_dir: the default"
printf 'db_dir = "/mnt/x y/$(touch hacked)"\n' >> "$ELECTRS_CONFIG"
electrs_db_dir "$DEFAULT_DB" >/dev/null 2>&1
check $(( $? != 0 ? 0 : 1 )) "a db_dir with spaces or shell characters is refused"

title "40: all four places use the existing index directory (P8)"
node_config
DB_DIR="$(electrs_db_dir "$DEFAULT_DB" 2>/dev/null)"
ELECTRS_PASS="oldPassw0rd_-x"
rm -rf "$NEW_DB" "$DEFAULT_DB"; : > "$LOG"
# 1. a user that does not exist yet is created with the directory as home
USER_EXISTS=0; ensure_electrs_user >/dev/null
grep -q "^useradd .*--home-dir ${NEW_DB} " "$LOG"
check $? "new user: useradd --home-dir is the existing index directory" "$(cat "$LOG")"
# an existing user with another home is moved, not left behind
: > "$LOG"; USER_EXISTS=1; USER_HOME="$DEFAULT_DB"
OUT="$(ensure_electrs_user)"
grep -q "^usermod .*${NEW_DB} electrs" "$LOG"
check $? "existing user with the old home: usermod to the index directory" "$(cat "$LOG")"
grep -q "$DEFAULT_DB" <<<"$OUT" && grep -q "$NEW_DB" <<<"$OUT"
check $? "and the output says from where to where" "$OUT"
: > "$LOG"; USER_HOME="$NEW_DB"; ensure_electrs_user >/dev/null
[[ ! -s "$LOG" ]]
check $? "existing user with the right home: left alone"
# 2. mkdir, chown, chmod
: > "$LOG"; prepare_db_dir
[[ -d "$NEW_DB" && ! -e "$DEFAULT_DB" ]]
check $? "mkdir: the index directory exists, the default one was not created"
grep -q "^chown -R electrs:electrs ${NEW_DB}\$" "$LOG"
check $? "chown -R on the index directory" "$(cat "$LOG")"
# 3. config.toml (existing file) and 4. the unit
write_electrs_config >/dev/null
write_electrs_unit
[[ "$(toml_get "$ELECTRS_CONFIG" db_dir)" == "$NEW_DB" ]]
check $? "config.toml: db_dir is the index directory"
grep -qx "ReadWritePaths=${NEW_DB}" "$ELECTRS_UNIT"
check $? "electrs.service: ReadWritePaths is the index directory" "$(grep ReadWrite "$ELECTRS_UNIT")"
no grep -rEq "${DEFAULT_DB}([^-A-Za-z0-9_.]|\$)" "$LOG" "$ELECTRS_CONFIG" "$ELECTRS_UNIT"
check $? "none of the four places carries the default directory" \
    "$(grep -rEn "${DEFAULT_DB}([^-A-Za-z0-9_.]|\$)" "$LOG" "$ELECTRS_CONFIG" "$ELECTRS_UNIT" | head -3)"
# a fresh machine: no config.toml at all, default directory, same code path
rm -f "$ELECTRS_CONFIG"; DB_DIR="$DEFAULT_DB"; write_electrs_config >/dev/null; write_electrs_unit
[[ "$(toml_get "$ELECTRS_CONFIG" db_dir)" == "$DEFAULT_DB" ]] && grep -qx "ReadWritePaths=${DEFAULT_DB}" "$ELECTRS_UNIT"
check $? "fresh machine: both files carry the default directory"

title "40: the electrs password is reused (P9)"
BTC_CONF="${DATADIR}/bitcoin.conf"
SECRETS="${E}/etc/bitcoin-access.conf"
node_config
printf 'rpcauth=bitcoinadmin:a$b\nrpcauth=electrs:salt$hash\n' > "$BTC_CONF"
printf "ADMIN_PASS='x'\n" > "$SECRETS"
ELECTRS_PASS=""
[[ "$(existing_electrs_pass)" == "oldPassw0rd_-x" ]]
check $? "the password is read from config.toml auth" "got $(existing_electrs_pass)"
ELECTRS_PASS=""; reuse_electrs_access
check $? "rpcauth=electrs in bitcoin.conf, no password in the credentials file: reused from config.toml"
[[ "$ELECTRS_PASS" == "oldPassw0rd_-x" ]]
check $? "and it is the one from config.toml"
ELECTRS_PASS="fromSecrets"; reuse_electrs_access && [[ "$ELECTRS_PASS" == "fromSecrets" ]]
check $? "a password in the credentials file wins"
printf 'rpcauth=bitcoinadmin:a$b\n' > "$BTC_CONF"
ELECTRS_PASS=""; reuse_electrs_access
check $(( $? != 0 ? 0 : 1 )) "no rpcauth=electrs in bitcoin.conf: a new account is needed"
printf 'rpcauth=electrs:salt$hash\n' > "$BTC_CONF"
ELECTRS_PASS=""; reuse_electrs_access
remember_electrs_access
grep -qx "ELECTRS_PASS='oldPassw0rd_-x'" "$SECRETS" && grep -qxF "ELECTRS_RPCAUTH='electrs:salt\$hash'" "$SECRETS"
check $? "the credentials file gets the two missing electrs lines" "$(sed 's/PASS=.*/PASS=<hidden>/' "$SECRETS")"
SUM="$(cksum < "$SECRETS")"; remember_electrs_access
[[ "$(cksum < "$SECRETS")" == "$SUM" ]]
check $? "and not twice"
# no bitcoind restart on the reuse path: it sits in the else branch
REUSE_LN="$(grep -n '^if reuse_electrs_access' "$S40" | head -1 | cut -d: -f1)"
ELSE_LN="$(awk -v s="${REUSE_LN:-0}" 'NR > s && /^else/ { print NR; exit }' "$S40")"
RESTART_LN="$(grep -n 'systemctl restart bitcoind' "$S40" | head -1 | cut -d: -f1)"
[[ -n "$REUSE_LN" && -n "$ELSE_LN" && -n "$RESTART_LN" && "$RESTART_LN" -gt "$ELSE_LN" ]]
check $? "bitcoind is restarted only in the branch that creates a new account"

title "40: no rebuild when the right version is installed (P10)"
BIN="${BOX}/electrs-bin"
printf '#!/usr/bin/env bash\necho "electrs 0.12.1"\n' > "$BIN"; chmod +x "$BIN"
electrs_is_current "$BIN" 0.12.1; check $? "electrs 0.12.1 installed, 0.12.1 wanted: current"
electrs_is_current "$BIN" 0.12.0; check $(( $? != 0 ? 0 : 1 )) "0.12.0 wanted: not current"
electrs_is_current "$BIN" 0.12;   check $(( $? != 0 ? 0 : 1 )) "0.12 wanted: not a prefix match"
printf '#!/usr/bin/env bash\necho "electrs 10.12.1"\n' > "$BIN"
electrs_is_current "$BIN" 0.12.1; check $(( $? != 0 ? 0 : 1 )) "10.12.1 is not 0.12.1"
electrs_is_current "${BOX}/missing" 0.12.1; check $(( $? != 0 ? 0 : 1 )) "no binary: not current"
grep -qF -- '--rebuild' "$S40"; check $? "--rebuild forces a build"
GATE_LN="$(grep -n 'electrs_is_current' "$S40" | grep -v '^[0-9]*:electrs_is_current()' | head -1 | cut -d: -f1)"
APT_LN="$(grep -n 'apt-get update' "$S40" | head -1 | cut -d: -f1)"
[[ -n "$GATE_LN" && -n "$APT_LN" && "$GATE_LN" -lt "$APT_LN" ]]
check $? "the check runs before apt-get update and the build tooling"

title "40: bitcoin-cli works for a sudo user without ~/.bitcoin (P11)"
JSON='{"verificationprogress":0.99999,"pruned":false}'
CLI_MODE=""
# The stand-in answers only to what a real bitcoin-cli would accept in that mode.
bitcoin-cli() {
    local DD="" USERNAME="" STDIN_PASS="" A
    for A in "$@"; do
        case "$A" in
            -datadir=*) DD="${A#-datadir=}" ;;
            -rpcuser=*) USERNAME="${A#-rpcuser=}" ;;
            -stdinrpcpass) read -r STDIN_PASS ;;
        esac
    done
    echo "bitcoin-cli $*" >> "$LOG"
    case "$CLI_MODE" in
        homeconf) [[ -z "$DD$USERNAME" ]] && { echo "$JSON"; return 0; } ;;
        cookie)   [[ -n "$DD" ]] && { echo "$JSON"; return 0; } ;;
        creds)    [[ "$USERNAME" == "bitcoinadmin" && "$STDIN_PASS" == "s3cret" ]] && { echo "$JSON"; return 0; } ;;
    esac
    echo "error: Could not locate RPC credentials" >&2
    return 1
}
sudo() { shift 2; "$@"; }
ADMIN_USER_RPC="bitcoinadmin"; ADMIN_PASS="s3cret"
: > "$LOG"
CLI_MODE=homeconf; [[ "$(chain_info sam "$DATADIR")" == "$JSON" ]]; check $? "the user has ~/.bitcoin/bitcoin.conf: used as before"
CLI_MODE=cookie;   [[ "$(chain_info sam "$DATADIR")" == "$JSON" ]]; check $? "no ~/.bitcoin/bitcoin.conf: the cookie in the data directory"
CLI_MODE=creds;    [[ "$(chain_info sam "$DATADIR")" == "$JSON" ]]; check $? "no conf, no cookie: the admin account from the credentials file"
no grep -q 's3cret' "$LOG"
check $? "the password never appears on a command line (read from stdin)"
CLI_MODE=none; [[ -z "$(chain_info sam "$DATADIR")" ]]; check $? "node does not answer: empty, the caller reports it"

title "40: values already in config.toml stay (P12)"
node_config; DB_DIR="$NEW_DB"; ELECTRS_PASS="oldPassw0rd_-x"; PORT_GIVEN=0
cp "$ELECTRS_CONFIG" "$BOX/config.orig"; rm -f "$ELECTRS_CONFIG".backup.*
write_electrs_config >/dev/null
cmp -s "$ELECTRS_CONFIG" "$BOX/config.orig"
check $? "the node's file comes out byte-identical (banner, comments, db_dir, auth)" "$(diff "$BOX/config.orig" "$ELECTRS_CONFIG" | head -4)"
ls "$ELECTRS_CONFIG".backup.* >/dev/null 2>&1
check $(( $? != 0 ? 0 : 1 )) "unchanged: no backup copy made"
# an old file without some keys: the keys are added, nothing else moves
printf 'network = "bitcoin"\ndb_dir = "%s"\nauth = "electrs:oldPassw0rd_-x"\nserver_banner = "mine"\nindex_lookup_limit = 50\n' "$NEW_DB" > "$ELECTRS_CONFIG"
write_electrs_config >/dev/null
[[ "$(toml_get "$ELECTRS_CONFIG" server_banner)" == "mine" ]] && grep -qx 'index_lookup_limit = 50' "$ELECTRS_CONFIG"
check $? "server_banner and index_lookup_limit of the owner are kept"
grep -q '^daemon_rpc_addr' "$ELECTRS_CONFIG" && grep -q '^electrum_rpc_addr = "127.0.0.1:50001"' "$ELECTRS_CONFIG"
check $? "missing keys are added"
ls "$ELECTRS_CONFIG".backup.* >/dev/null 2>&1
check $? "a changed file is backed up first"
# --port given: that one value follows
PORT_GIVEN=1; ELECTRS_PORT=50002; write_electrs_config >/dev/null
grep -qx 'electrum_rpc_addr = "127.0.0.1:50002"' "$ELECTRS_CONFIG"
check $? "an explicit --port changes electrum_rpc_addr"
PORT_GIVEN=0; ELECTRS_PORT=50001
# a changed password in the credentials means a new account: auth follows
ELECTRS_PASS="brandNew"; write_electrs_config >/dev/null
[[ "$(toml_get "$ELECTRS_CONFIG" auth)" == "electrs:brandNew" ]]
check $? "auth follows a newly created account"

title "40: older credentials file (P13)"
mkdir -p "$E/etc2"; rm -f "$E/etc2"/*
find_access_file "$E/etc2" >/dev/null 2>&1; check $(( $? != 0 ? 0 : 1 )) "neither file: not found"
: > "$E/etc2/bitcoin-zugang.conf"
[[ "$(find_access_file "$E/etc2")" == "$E/etc2/bitcoin-zugang.conf" ]]
check $? "only the old name: that one"
: > "$E/etc2/bitcoin-access.conf"
[[ "$(find_access_file "$E/etc2")" == "$E/etc2/bitcoin-access.conf" ]]
check $? "both: the new name wins"

title "40: the unit keeps its limits, and a second run changes nothing (P14, P15)"
node_config; DB_DIR="$NEW_DB"; ELECTRS_PASS="oldPassw0rd_-x"
write_electrs_config >/dev/null; write_electrs_unit
grep -qx 'LimitNOFILE=65536' "$ELECTRS_UNIT"; check $? "LimitNOFILE=65536 is in the generated unit"
# systemctl show reports the unit as systemd merged it; the stand-in reads our unit file.
systemctl() { grep -E '^(User|Group|SupplementaryGroups|LimitNOFILE|ReadWritePaths|ReadOnlyPaths)=' "$ELECTRS_UNIT"; }
SUM1="$(electrs_state_sum)"
write_electrs_config >/dev/null; write_electrs_unit
[[ "$(electrs_state_sum)" == "$SUM1" ]]
check $? "running the generation again yields the same files (so no needless restart)"
sed -i 's/^Description=.*/Description=Electrum-Server (electrs)/' "$ELECTRS_UNIT"
[[ "$(electrs_state_sum)" == "$SUM1" ]]
check $? "a different description in the unit is no reason to restart"
sed -i 's|^ReadWritePaths=.*|ReadWritePaths=/mnt/bitcoin/other|' "$ELECTRS_UNIT"
[[ "$(electrs_state_sum)" != "$SUM1" ]]
check $? "another ReadWritePaths is"
write_electrs_unit
sed -i 's/^Nice=.*/Nice=5/;s/^LimitNOFILE=.*/LimitNOFILE=1024/' "$ELECTRS_UNIT"
[[ "$(electrs_state_sum)" != "$SUM1" ]]
check $? "another LimitNOFILE is"
write_electrs_unit
printf 'log_filters = "DEBUG"\n' >> "$ELECTRS_CONFIG"
sed -i '/^log_filters = "INFO"/d' "$ELECTRS_CONFIG"
[[ "$(electrs_state_sum)" != "$SUM1" ]]
check $? "a change in config.toml is"
unset -f systemctl
grep -q 'ELECTRS_WAS_ACTIVE' "$S40" && grep -q 'systemctl restart electrs' "$S40"
check $? "electrs is restarted only if it ran and its files changed"
TOR_LN="$(grep -n 'TOR_CHANGED' "$S40" | head -1 | cut -d: -f1)"
[[ -n "$TOR_LN" ]] && no grep -qE '^    systemctl restart tor$' "$S40" && grep -q 'dpkg -s tor' "$S40"
check $? "tor is restarted only if torrc changed or tor was not running"

# ==================================================================== Result =
printf '\n'
if (( FAILURES == 0 )); then
    printf '\033[32m=== existing-node checks passed ===\033[0m\n'
    exit 0
fi
printf '\033[31m=== %s existing-node check(s) failed ===\033[0m\n' "$FAILURES"
exit 1
