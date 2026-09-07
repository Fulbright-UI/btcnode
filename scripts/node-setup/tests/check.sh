#!/usr/bin/env bash
#
# tests/check.sh — checks the builder scripts without running them.
#
# These scripts partition disks, install services and change firewalls. None
# of that can be tried out in a test: by the time you notice the mistake, the
# disk is gone. So what is checked here is the shape of the scripts — that the
# guards are present, that the destructive commands sit behind them, and that
# nothing personal is left in the files.
#
# Needs no root, touches nothing.
#
# Usage:  bash tests/check.sh

set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

FAILURES=0
check() {
    if [[ "$1" == "0" ]]; then
        printf '  [ ok ] %s\n' "$2"
    else
        printf '  [FAIL] %s\n' "$2"
        [[ -n "${3:-}" ]] && printf '         %s\n' "$3"
        FAILURES=$(( FAILURES + 1 ))
    fi
}
title() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

SCRIPTS=(10-check.sh 20-storage.sh 30-bitcoin-core.sh 40-electrs.sh 50-tor.sh 55-i2p.sh
         60-tor-automatic.sh)

# The watchdog is not one of the numbered scripts — it is installed by
# 60-tor-automatic.sh and run by a timer, never by a person. It has no --help
# and no questions, so it takes part in the checks that apply to every file
# but not in the ones about the command line.
ALL=("${SCRIPTS[@]}" tor-after-sync.sh)

# ==================================================================== Syntax =
title "Syntax"
for S in "${ALL[@]}"; do
    [[ -f "$S" ]] || { check 1 "$S exists"; continue; }
    OUT="$(bash -n "$S" 2>&1)"
    check $? "$S parses" "$OUT"
done

if command -v shellcheck >/dev/null 2>&1; then
    title "shellcheck"
    for S in "${ALL[@]}"; do
        OUT="$(shellcheck -S warning "$S" 2>&1)"
        check $? "$S clean at warning level" "$(head -3 <<<"$OUT")"
    done
else
    printf '\n  [ --  ] shellcheck not installed, skipped\n'
fi

# ================================================================== Interface =
title "Interface"
for S in "${SCRIPTS[@]}"; do
    grep -qF -- '--help' "$S"
    check $? "$S understands --help"
done

# Every script that changes something must refuse to run without root. Only
# 10-check.sh is exempt — it changes nothing and should be usable without
# sudo.
for S in 20-storage.sh 30-bitcoin-core.sh 40-electrs.sh 50-tor.sh \
         60-tor-automatic.sh tor-after-sync.sh; do
    grep -q 'EUID -eq 0' "$S"
    check $? "$S refuses to run without root"
done
grep -q 'EUID -eq 0' 10-check.sh
check $(( $? == 0 ? 1 : 0 )) "10-check.sh works without root"

# ============================================================= The wipe guard =
title "Storage: the wipe guard"

# The single most important property of this whole repository: without --wipe
# nothing is erased. If this check ever fails, do not release.
grep -q 'WIPE=0' 20-storage.sh
check $? "dry run is the default (WIPE=0)"

grep -q 'if (( WIPE == 0 )); then' 20-storage.sh
check $? "there is a branch that exits before anything destructive"

# Every destructive command must appear AFTER the guard, never before.
GUARD_LINE="$(grep -n 'if (( WIPE == 0 )); then' 20-storage.sh | head -1 | cut -d: -f1)"
check $(( GUARD_LINE > 0 ? 0 : 1 )) "the guard was found (line ${GUARD_LINE:-?})"

EARLY=""
for CMD in 'mkfs\.' 'sgdisk' 'wipefs' 'pvcreate' 'vgcreate' 'lvcreate' 'pvremove' 'vgremove'; do
    while IFS=: read -r LN _; do
        [[ -z "$LN" ]] && continue
        (( LN < GUARD_LINE )) && EARLY="${EARLY} ${CMD}:${LN}"
    done < <(grep -n "$CMD" 20-storage.sh | grep -v '^\s*#' || true)
done
check $([[ -z "${EARLY// /}" ]] && echo 0 || echo 1) \
    "no destructive command before the guard" "$EARLY"

# The four refusals in the safety block
for PATTERN in 'is not a block device' 'running system disk' 'carries the running system' 'mounted filesystems'; do
    grep -q "$PATTERN" 20-storage.sh
    check $? "refusal present: \"$PATTERN\""
done

# The confirmation must ask for the device path, not for a word anyone types
# without reading.
grep -q 'Type the device path' 20-storage.sh
check $? "confirmation asks for the device path to be typed"

# ============================================================== No hardcoding =
title "Nothing personal, nothing hardcoded"

# The test file itself carries the search pattern, so it is excluded — a
# check that always trips over its own text teaches nobody anything.
PERSONAL="$(grep -rniE '[a-z2-7]{56}\.onion|192\.168\.[0-9]+\.[0-9]{1,3}:|btcnode\.local' \
    --include='*.sh' --include='*.md' . 2>/dev/null \
    | grep -v '^\./tests/check\.sh:' \
    | grep -viE '192\.168\.1\.0/24|192\.168\.1\.50' || true)"
check $([[ -z "$PERSONAL" ]] && echo 0 || echo 1) \
    "no onion address, home IP or personal name" "$(head -3 <<<"$PERSONAL")"

# A fixed device name in a script that erases disks is how somebody else's
# data gets destroyed. The disks must always come from the command line.
FIXED="$(grep -nE '^\s*DISKS=\(\s*/dev/' 20-storage.sh || true)"
check $([[ -z "$FIXED" ]] && echo 0 || echo 1) \
    "no device name hardcoded in 20-storage.sh" "$FIXED"

# ============================================================ Non-interactive =
title "Usable without a terminal"

# Piped into a shell there is nobody to answer. Every read must therefore sit
# behind a check for a terminal or behind --yes; otherwise the script hangs
# forever in an automated install.
for S in "${SCRIPTS[@]}"; do
    BAD=""
    while IFS=: read -r LN TEXT; do
        [[ -z "$LN" ]] && continue
        # Look at the lines above: is there a -t 0 or ASSUME_YES guard? The
        # window is generous because a guard often sits above a comment block
        # explaining why the question is asked at all.
        CONTEXT="$(sed -n "$(( LN > 18 ? LN - 18 : 1 )),${LN}p" "$S")"
        grep -qE '\-t 0|ASSUME_YES|confirm\(\)|FORCE ==' <<<"$CONTEXT" || BAD="${BAD} ${S}:${LN}"
        # A read whose input is redirected — from a here-string, a process
        # substitution or a file — is not a question to anybody. It is how a
        # shell script takes several values apart, and it can never hang.
    done < <(grep -nE '^\s*read -r' "$S" \
             | grep -vE '<<<|< <\(|< "' || true)
    check $([[ -z "${BAD// /}" ]] && echo 0 || echo 1) \
        "$S: every question is guarded" "$BAD"
done

# ============================================================== The watchdog =
# Everything above reads the scripts. The watchdog is the one program here
# that changes a running node on its own, so it is also executed — against a
# fake node, below a temporary directory. See tests/tor-after-sync-test.sh.
if [[ -f tests/tor-after-sync-test.sh ]]; then
    printf '\n'
    if bash tests/tor-after-sync-test.sh; then
        check 0 "watchdog behaves as documented"
    else
        check 1 "watchdog behaves as documented" "see the output above"
    fi
fi

# ================================================================== Firewall =
title "Firewall: rules are deleted by mark or anchored port"

# 2026-09-06: grep -q "${PORT}/tcp" with no anchor matched 8080/tcp for port
# 80 and 18333/tcp for 8333, and the loop deleted every hit in silence. And
# "yes | ufw delete" under pipefail broke the loop after the first of two
# rules (v4/v6). Neither may come back.
for f in "${SCRIPTS[@]}"; do
    ! grep -Eq 'grep -q[^|]*/tcp' "$f"
    check "$?" "$f: no unanchored port grep on ufw status"
    ! grep -q 'yes | ufw' "$f"
    check "$?" "$f: ufw delete uses --force, not yes |"
done

# ==================================================================== Result =
printf '\n'
if (( FAILURES == 0 )); then
    printf '\033[32m=== all checks passed ===\033[0m\n'
    exit 0
fi
printf '\033[31m=== %s check(s) failed ===\033[0m\n' "$FAILURES"
exit 1
