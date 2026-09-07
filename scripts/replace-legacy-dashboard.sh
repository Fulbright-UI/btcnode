#!/usr/bin/env bash
#
# scripts/replace-legacy-dashboard.sh — the switch-over.
#
# Retires the old node-dashboard (Python generator + host nginx on port 80)
# and moves this dashboard to 443/80. Run it once the new page on 8443 has
# been compared and found good.
#
# What it does:
#   1. stops and disables node-dashboard, node-updatecheck.timer, the host nginx
#   2. removes their ufw rules (port 80, recognised by the old comments)
#   3. sets WEB_PORT=443 / HTTP_PORT=80 in deploy/.env, opens them in ufw,
#      closes 8443/8080 again
#   4. restarts the containers and checks https://127.0.0.1/
#
# Nothing is deleted from disk: the old program stays under /usr/local/bin,
# its config in /etc/node-dashboard.conf, the old page in /var/www/node.
# Remove them by hand when you no longer want them.
#
# Usage:  sudo bash scripts/replace-legacy-dashboard.sh [--yes]

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY="$REPO/deploy"
ASSUME_YES=0
[[ "${1:-}" == "--yes" || "${1:-}" == "-y" ]] && ASSUME_YES=1

if [[ -t 1 ]]; then BOLD=$'\e[1m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; RESET=$'\e[0m'; else BOLD=""; GREEN=""; YELLOW=""; RED=""; RESET=""; fi
title() { printf '\n%s== %s ==%s\n' "$BOLD" "$*" "$RESET"; }
ok()    { printf '  %s[ok]%s %s\n' "$GREEN" "$RESET" "$*"; }
note()  { printf '  %s[..]%s %s\n' "$YELLOW" "$RESET" "$*"; }
fail()  { printf '  %s[!!]%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "run as root"
[[ -f "$DEPLOY/.env" ]] || fail "deploy/.env missing — run scripts/install.sh first"
OLD_WEB="$(sed -n 's/^WEB_PORT=//p' "$DEPLOY/.env")"
OLD_HTTP="$(sed -n 's/^HTTP_PORT=//p' "$DEPLOY/.env")"

title "This will"
echo "  - stop and disable: node-dashboard, node-updatecheck.timer, nginx (host)"
echo "  - move the dashboard from ${OLD_WEB}/${OLD_HTTP} to 443/80"
if [[ $ASSUME_YES -eq 0 && -t 0 ]]; then
  read -r -p "  Continue? [y/N] " a
  [[ "$a" =~ ^[Yy] ]] || exit 0
fi

title "Old services"
for unit in node-dashboard.service node-updatecheck.timer node-updatecheck.service node-torwaechter.timer nginx.service; do
  if systemctl list-unit-files "$unit" --no-legend 2>/dev/null | grep -q "$unit"; then
    systemctl disable --now "$unit" >/dev/null 2>&1 || true
    ok "$unit stopped and disabled"
  fi
done

title "Firewall"
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
  # The old scripts marked their rules "node-dashboard"; ours "btcnode-web".
  while read -r num; do
    [[ -n "$num" ]] && ufw --force delete "$num" >/dev/null
  done < <(ufw status numbered | grep -E "^\[ *[0-9]+\] 80/tcp .* node-dashboard$" | sed -E 's/^\[ *([0-9]+)\].*/\1/' | sort -rn)
  ok "old port-80 rules removed"
  LAN="$(ufw status | grep -E " btcnode-web$" | head -1 | awk '{print $3}')"
  LAN="${LAN:-192.168.0.0/16}"
  for port in 443 80; do
    ufw status | grep -qE "^${port}/tcp .* btcnode-web$" || ufw allow from "$LAN" to any port "$port" proto tcp comment btcnode-web >/dev/null
  done
  ok "443 and 80 open for $LAN"
  for port in "$OLD_WEB" "$OLD_HTTP"; do
    [[ "$port" == 443 || "$port" == 80 ]] && continue
    while read -r num; do
      [[ -n "$num" ]] && ufw --force delete "$num" >/dev/null
    done < <(ufw status numbered | grep -E "^\[ *[0-9]+\] ${port}/tcp .* btcnode-web$" | sed -E 's/^\[ *([0-9]+)\].*/\1/' | sort -rn)
  done
  ok "temporary ports closed"
else
  note "ufw not active — nothing to do"
fi

title "Containers"
sed -i -e 's/^WEB_PORT=.*/WEB_PORT=443/' -e 's/^HTTP_PORT=.*/HTTP_PORT=80/' "$DEPLOY/.env"
cd "$DEPLOY"
docker compose up -d
for _ in $(seq 1 30); do
  curl -sk https://127.0.0.1/api/health | grep -q '"ok":true' && break
  sleep 2
done
curl -sk https://127.0.0.1/api/health | grep -q '"ok":true' || fail "the page does not answer on 443 — docker compose logs"
ok "dashboard answers on https://$(hostname -I | awk '{print $1}')/"
echo
echo "  http://…/ now redirects to https. The old files stay where they were:"
echo "  /usr/local/bin/node-dashboard, /etc/node-dashboard.conf, /var/www/node"
