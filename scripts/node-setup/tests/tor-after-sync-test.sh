#!/usr/bin/env bash
#
# tor-after-sync-test.sh — run the watchdog for real, against a fake node.
#
# check.sh reads the scripts. This one executes one of them, because the
# watchdog is the only program in this project that changes a running node's
# configuration on its own, an hour after the event that triggered it and with
# nobody watching. Reading it is not enough.
#
# Nothing outside a temporary directory is touched: TAS_ROOT moves every path
# the watchdog uses below it, and bitcoin-cli, sudo and systemctl are replaced
# by stand-ins on PATH. The script under test is the real one, unmodified —
# a test that runs a copy of the logic is a test that goes stale.
#
# Usage:  bash tests/tor-after-sync-test.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$(dirname "$HERE")"
WATCHDOG="${PROJECT}/tor-after-sync.sh"

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

BOX="$(mktemp -d)"
trap 'rm -rf "$BOX"' EXIT

# --------------------------------------------------------------- stand-ins --
# Realistic shapes, not just something that parses: verificationprogress
# arrives as a float in scientific-looking precision, and initialblockdownload
# stays true until the very end. The values come from the case file, so a test
# can change the node's answer between runs the way a real chain does.
mkdir -p "${BOX}/bin"
cat > "${BOX}/bin/bitcoin-cli" <<'EOF'
#!/usr/bin/env bash
# Only getblockchaininfo is ever asked of it — anything else is a mistake we
# want to see, not swallow.
if [[ "$*" != *getblockchaininfo* ]]; then
    echo "unexpected call: $*" >&2
    exit 1
fi
case "$(cat "${BOX}/case")" in
    behind) echo '{"verificationprogress":0.9891234,"initialblockdownload":true}' ;;
    synced) echo '{"verificationprogress":0.9999987,"initialblockdownload":false}' ;;
    silent) echo "error: timeout while waiting for reply" >&2; exit 1 ;;
esac
EOF
# sudo -u <user> <command...> — drop the two arguments, run the rest.
cat > "${BOX}/bin/sudo" <<'EOF'
#!/usr/bin/env bash
[[ "${1:-}" == "-u" ]] && shift 2
exec "$@"
EOF
# systemctl has to keep state, or the test cannot tell "switch electrs on"
# apart from "leave the one that is already on alone". Both calls look the
# same to a stand-in that answers 0 to everything.
cat > "${BOX}/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
echo "systemctl $*" >> "${BOX}/events"
# Via a variable, not "${*##* }" directly: on the special parameter the
# expansion does not strip what you expect, and the stand-in then answers
# every question with "no".
ARGS="$*"
UNIT="${ARGS##* }"
case "$1" in
    is-active)  [[ "$UNIT" == "bitcoind" ]] && exit 0 || exit 1 ;;
    is-enabled) grep -qx "$UNIT" "${BOX}/enabled" 2>/dev/null && exit 0 || exit 1 ;;
    enable)     grep -qx "$UNIT" "${BOX}/enable-fails" 2>/dev/null && exit 1
                echo "$UNIT" >> "${BOX}/enabled"; exit 0 ;;
esac
exit 0
EOF
chmod 0755 "${BOX}/bin/"*
export BOX
export PATH="${BOX}/bin:${PATH}"
export TAS_ROOT="${BOX}/root"

# ----------------------------------------------------------- fake install --
mkdir -p "${TAS_ROOT}/etc/systemd/system" \
         "${TAS_ROOT}/usr/local/lib/btcnode" \
         "${BOX}/data"
cat > "${TAS_ROOT}/etc/systemd/system/bitcoind.service" <<EOF
[Service]
ExecStart=/usr/local/bin/bitcoind -datadir=${BOX}/data -conf=${BOX}/data/bitcoin.conf
EOF
printf 'dbcache=450\nmaxmempool=300\n' > "${BOX}/data/bitcoin.conf"

# The switch script the watchdog calls. It records that it ran and with which
# arguments, and its exit code is whatever the test asks for.
cat > "${TAS_ROOT}/usr/local/lib/btcnode/50-tor.sh" <<'EOF'
#!/usr/bin/env bash
echo "50-tor.sh $*" >> "${BOX}/events"
exit "$(cat "${BOX}/switch-exit" 2>/dev/null || echo 0)"
EOF
chmod 0755 "${TAS_ROOT}/usr/local/lib/btcnode/50-tor.sh"

run() { bash "$WATCHDOG" >>"${BOX}/out" 2>&1; echo $?; }
hits() { cat "${TAS_ROOT}/var/lib/tor-after-sync/hits" 2>/dev/null || echo "-"; }
switched() { grep -q '^50-tor\.sh' "${BOX}/events" 2>/dev/null && echo yes || echo no; }
# Everything the watchdog reaches the system through — the switch script and
# systemctl — writes into one file, in order. That is what makes it possible
# to check not just that both happened but that they happened the right way
# round: electrs must not be switched on before the node is back.
events() { cat "${BOX}/events" 2>/dev/null; }

# ============================================================ Not yet synced =
title "While the chain is still behind"
echo behind > "${BOX}/case"
run >/dev/null
check $([[ "$(hits)" == "-" || "$(hits)" == "0" ]] && echo 0 || echo 1) \
    "no reading is counted" "hits=$(hits)"
check $([[ "$(switched)" == "no" ]] && echo 0 || echo 1) \
    "50-tor.sh is not called"

# =============================================================== Counting up =
title "Once the chain is up to date"
echo synced > "${BOX}/case"
for I in 1 2 3 4 5; do run >/dev/null; done
check $([[ "$(hits)" == "5" ]] && echo 0 || echo 1) \
    "five readings are counted" "hits=$(hits)"
check $([[ "$(switched)" == "no" ]] && echo 0 || echo 1) \
    "an hour is not over yet, so nothing is switched"

# A single hiccup must not undo an hour of waiting: bitcoind stalls its RPC
# thread while it flushes the dbcache, and that is not the chain falling
# behind.
title "A hiccup in between"
echo silent > "${BOX}/case"
run >/dev/null
check $([[ "$(hits)" == "5" ]] && echo 0 || echo 1) \
    "an unanswered call keeps the readings" "hits=$(hits)"
check $([[ "$(switched)" == "no" ]] && echo 0 || echo 1) \
    "and switches nothing"

# But falling behind again does reset it — that is a different chain state,
# not a missing answer.
title "Falling behind again"
echo behind > "${BOX}/case"
run >/dev/null
check $([[ "$(hits)" == "0" ]] && echo 0 || echo 1) \
    "the counter starts over" "hits=$(hits)"

# ================================================================ The switch =
title "The sixth reading"
echo synced > "${BOX}/case"
for I in 1 2 3 4 5 6; do run >/dev/null; done
check $([[ "$(switched)" == "yes" ]] && echo 0 || echo 1) \
    "50-tor.sh is called"
check $(grep -q -- '--yes' "${BOX}/events" 2>/dev/null && echo 0 || echo 1) \
    "and called with --yes, because nobody is sitting there" \
    "$(cat "${BOX}/events" 2>/dev/null)"
check $([[ -f "${TAS_ROOT}/var/lib/tor-after-sync/done" ]] && echo 0 || echo 1) \
    "the marker is written"
check $(grep -q 'disable --now tor-after-sync.timer' "${BOX}/events" \
        && echo 0 || echo 1) \
    "the timer switches itself off"

CALLS="$(grep -c '^50-tor.sh' "${BOX}/events")"
title "Every run after that"
for I in 1 2 3; do run >/dev/null; done
check $([[ "$(grep -c '^50-tor.sh' "${BOX}/events")" == "$CALLS" ]] && echo 0 || echo 1) \
    "50-tor.sh is never called a second time"

# ========================================================== After a failure =
# The marker is written before the call, so a failed switch is not repeated.
# Running over a half-converted configuration a second time makes it worse.
title "When the switch fails"
rm -rf "${TAS_ROOT}/var/lib/tor-after-sync" "${BOX}/events" "${BOX}/enabled"
echo 1 > "${BOX}/switch-exit"
echo synced > "${BOX}/case"
for I in 1 2 3 4 5 6; do LAST="$(run)"; done
check $([[ "$LAST" == "1" ]] && echo 0 || echo 1) \
    "the failure reaches systemd as a non-zero exit" "exit=${LAST}"
check $([[ -f "${TAS_ROOT}/var/lib/tor-after-sync/done" ]] && echo 0 || echo 1) \
    "the marker stands even though the switch failed"
check $(grep -q 'undo:' "${BOX}/out" && echo 0 || echo 1) \
    "the log says how to undo it"
BEFORE="$(grep -c '^50-tor.sh' "${BOX}/events")"
run >/dev/null
check $([[ "$(grep -c '^50-tor.sh' "${BOX}/events")" == "$BEFORE" ]] && echo 0 || echo 1) \
    "and it is not retried"

# ================================================================== electrs =
# 40-electrs.sh installs electrs but leaves it switched off while the chain is
# still coming down — its first index pass and the initial sync fight over the
# same disk. Switching it on is the watchdog's second job, and it has to
# happen after the node is back, not before.
title "electrs, once the node is back"
rm -rf "${TAS_ROOT}/var/lib/tor-after-sync" "${BOX}/events" "${BOX}/enabled"
rm -f "${BOX}/switch-exit"
: > "${TAS_ROOT}/etc/systemd/system/electrs.service"
: > "${TAS_ROOT}/etc/systemd/system/electrs-lan.service"
echo synced > "${BOX}/case"
for I in 1 2 3 4 5 6; do run >/dev/null; done
check $(grep -q 'enable --now electrs$' "${BOX}/events" && echo 0 || echo 1) \
    "electrs is switched on"
check $(grep -q 'enable --now electrs-lan' "${BOX}/events" && echo 0 || echo 1) \
    "and so is the LAN forwarding"

SWITCH_AT="$(grep -n '^50-tor\.sh' "${BOX}/events" | head -1 | cut -d: -f1)"
ELECTRS_AT="$(grep -n 'enable --now electrs$' "${BOX}/events" | head -1 | cut -d: -f1)"
check $([[ -n "$SWITCH_AT" && -n "$ELECTRS_AT" && "$ELECTRS_AT" -gt "$SWITCH_AT" ]] \
        && echo 0 || echo 1) \
    "but only after 50-tor.sh — electrs needs a node that answers" \
    "50-tor.sh at ${SWITCH_AT:-?}, electrs at ${ELECTRS_AT:-?}"

title "electrs that is already running"
rm -rf "${TAS_ROOT}/var/lib/tor-after-sync" "${BOX}/events"
printf 'electrs\nelectrs-lan\n' > "${BOX}/enabled"
for I in 1 2 3 4 5 6; do run >/dev/null; done
check $(grep -q 'enable --now electrs' "${BOX}/events" && echo 1 || echo 0) \
    "is left alone"

title "A node without electrs"
rm -rf "${TAS_ROOT}/var/lib/tor-after-sync" "${BOX}/events" "${BOX}/enabled"
rm -f "${TAS_ROOT}/etc/systemd/system/electrs.service" \
      "${TAS_ROOT}/etc/systemd/system/electrs-lan.service"
for I in 1 2 3 4 5 6; do LAST="$(run)"; done
check $([[ "$LAST" == "0" ]] && echo 0 || echo 1) \
    "is no reason to fail" "exit=${LAST}"
check $(grep -q 'enable --now electrs' "${BOX}/events" && echo 1 || echo 0) \
    "and nothing is switched on that is not there"

# electrs failing to start is not a reason to call the whole switch failed:
# Tor is up, which was the point. But it has to be said out loud, because a
# wallet that cannot reach its server is what gets noticed, days later.
title "When electrs refuses to start"
rm -rf "${TAS_ROOT}/var/lib/tor-after-sync" "${BOX}/events" "${BOX}/enabled"
: > "${TAS_ROOT}/etc/systemd/system/electrs.service"
echo electrs > "${BOX}/enable-fails"
: > "${BOX}/out"
for I in 1 2 3 4 5 6; do LAST="$(run)"; done
check $([[ "$LAST" == "0" ]] && echo 0 || echo 1) \
    "the Tor switch still counts as done" "exit=${LAST}"
check $(grep -q 'electrs did not start' "${BOX}/out" && echo 0 || echo 1) \
    "but the log says so"
rm -f "${BOX}/enable-fails"

# ====================================================== Switched by hand ====
title "When somebody switched by hand"
rm -rf "${TAS_ROOT}/var/lib/tor-after-sync" "${BOX}/events" "${BOX}/enabled"
printf 'proxy=127.0.0.1:9050\n' >> "${BOX}/data/bitcoin.conf"
run >/dev/null
check $([[ "$(switched)" == "no" ]] && echo 0 || echo 1) \
    "nothing is switched a second time"
check $(grep -q 'disable --now tor-after-sync.timer' "${BOX}/events" \
        && echo 0 || echo 1) \
    "and the timer stands down"

printf '\n'
if (( FAILURES == 0 )); then
    printf '\033[32m=== watchdog: all checks passed ===\033[0m\n'
    exit 0
fi
printf '\033[31m=== watchdog: %s check(s) failed ===\033[0m\n' "$FAILURES"
exit 1
