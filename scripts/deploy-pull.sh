#!/usr/bin/env bash
#
# scripts/deploy-pull.sh — runs the dashboard from the published, signed images.
#
# What it does, in order:
#   1. cosign, pinned version, checksum-checked — installed if it is missing
#   2. resolves the tag (default: main) of both images on GHCR to a digest
#   3. checks each digest's signature with cosign: keyless, the certificate
#      must name this repository's ci workflow on main or on a version tag,
#      issued through GitHub's OIDC — any other signer, or none, stops here
#   4. only when both hold: writes the two digests into deploy/.env
#      (API_IMAGE, WEB_IMAGE), docker compose pull, up -d, checks the page;
#      if the page does not come back, the previous digests are put back
#
# Nothing unverified is ever started: compose only sees digests, and a digest
# names exactly the bytes whose signature was checked.
#
# Usage:  sudo bash scripts/deploy-pull.sh [--tag main|sha-1234567|4.1.0] [--yes]
#         sudo bash scripts/deploy-pull.sh --pull-only     (verify and pull, print
#                                                           the references, touch nothing)
#         sudo bash scripts/deploy-pull.sh --install-cosign (only put cosign in place)
#
# Back to building from the checkout instead: see deploy/docker-compose.build.yml.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY="$REPO/deploy"
REGISTRY="ghcr.io"
NAMESPACE="fulbright-ui"
IMAGES=(api web)
TAG="main"
PULL_ONLY=0
INSTALL_ONLY=0
ASSUME_YES=0

# Who may have signed: the ci workflow of this repository, run for main or a
# version tag, with a certificate from GitHub's OIDC issuer.
OIDC_ISSUER="https://token.actions.githubusercontent.com"
IDENTITY_REGEXP='^https://github\.com/Fulbright-UI/btcnode/\.github/workflows/ci\.yml@refs/(heads/main|tags/v[0-9]+\.[0-9]+\.[0-9]+)$'

# The cosign release used here and in CI, and the SHA-256 of its binaries
# (cosign_checksums.txt of that release).
COSIGN_VERSION="v3.1.4"
COSIGN_SHA256_arm64="ade83b7aac62e131cacfe96d958948b2150cc9efec46a570a2649b8e27dedad2"
COSIGN_SHA256_amd64="424e2c97d0b45fd7a6b608a87f090f35633f4c23ece5f092d48bba11aaf4bbfa"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG="${2:?--tag needs a value}"; shift 2 ;;
    --pull-only) PULL_ONLY=1; shift ;;
    --install-cosign) INSTALL_ONLY=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

# Everything goes to stderr; stdout carries only what --pull-only prints.
if [[ -t 2 ]]; then BOLD=$'\e[1m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; RESET=$'\e[0m'; else BOLD=""; GREEN=""; YELLOW=""; RED=""; RESET=""; fi
title() { printf '\n%s== %s ==%s\n' "$BOLD" "$*" "$RESET" >&2; }
ok()    { printf '  %s[ok]%s %s\n' "$GREEN" "$RESET" "$*" >&2; }
note()  { printf '  %s[..]%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
fail()  { printf '  %s[!!]%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }
ask() {
  local q="$1" d="${2:-n}" a
  if [[ $ASSUME_YES -eq 1 || ! -t 0 ]]; then [[ "$d" == y ]]; return; fi
  read -r -p "  $q [$([[ $d == y ]] && echo Y/n || echo y/N)] " a
  a="${a:-$d}"; [[ "$a" =~ ^[Yy] ]]
}

[[ $EUID -eq 0 ]] || fail "run as root: sudo bash scripts/deploy-pull.sh"
[[ "$TAG" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || fail "--tag: not a valid image tag"
command -v curl >/dev/null || fail "curl is required"

# ------------------------------------------------------------------ 1. cosign
install_cosign() {
  local arch sum tmp
  case "$(uname -m)" in
    aarch64|arm64) arch=arm64; sum="$COSIGN_SHA256_arm64" ;;
    x86_64|amd64) arch=amd64; sum="$COSIGN_SHA256_amd64" ;;
    *) fail "no cosign binary for $(uname -m) pinned here" ;;
  esac
  tmp="$(mktemp)"
  curl -fsSL --proto '=https' -o "$tmp" \
    "https://github.com/sigstore/cosign/releases/download/${COSIGN_VERSION}/cosign-linux-${arch}"
  if ! echo "$sum  $tmp" | sha256sum -c --status; then
    rm -f "$tmp"
    fail "cosign download does not match the pinned SHA-256 — not installed"
  fi
  install -m 0755 "$tmp" /usr/local/bin/cosign
  rm -f "$tmp"
  ok "cosign $COSIGN_VERSION installed to /usr/local/bin/cosign (SHA-256 checked)"
}

title "cosign"
if [[ $INSTALL_ONLY -eq 1 ]]; then
  install_cosign
  exit 0
fi
if command -v cosign >/dev/null; then
  have="$(cosign version 2>/dev/null | awk '/^GitVersion:/ {print $2}')"
  ok "cosign ${have:-?} at $(command -v cosign)"
  [[ "$have" == "$COSIGN_VERSION" ]] || note "CI signs with cosign $COSIGN_VERSION — if verifying fails, run with --install-cosign"
else
  ask "cosign is missing — install $COSIGN_VERSION (checksum-checked) to /usr/local/bin?" y \
    || fail "cosign is required: sudo bash scripts/deploy-pull.sh --install-cosign"
  install_cosign
fi

# ------------------------------------------------- 2. tag → digest, 3. verify
digest_of() {
  # $1: repository path, $2: tag. Anonymous pull token; prints sha256:… or nothing.
  local token
  token="$(curl -fsS "https://$REGISTRY/token?scope=repository:$1:pull" \
    | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')" || return 0
  [[ -n "$token" ]] || return 0
  curl -fsSI -H "Authorization: Bearer $token" \
    -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' \
    "https://$REGISTRY/v2/$1/manifests/$2" \
    | tr -d '\r' | awk -F': ' 'tolower($1) == "docker-content-digest" {print $2}' || true
}

title "Signatures (tag $TAG)"
declare -A REF
for name in "${IMAGES[@]}"; do
  repo="$NAMESPACE/btcnode-$name"
  digest="$(digest_of "$repo" "$TAG")"
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || fail "$REGISTRY/$repo:$TAG not found (or the package is not public)"
  ref="$REGISTRY/$repo@$digest"
  if ! cosign verify "$ref" \
      --certificate-oidc-issuer "$OIDC_ISSUER" \
      --certificate-identity-regexp "$IDENTITY_REGEXP" >/dev/null; then
    fail "$ref: no valid signature from this repository's ci workflow — nothing deployed"
  fi
  ok "btcnode-$name:$TAG → $digest, signed by the ci workflow"
  REF[$name]="$ref"
done

# ------------------------------------------------------------------ 4. deploy
title "Pull"
for name in "${IMAGES[@]}"; do
  docker pull -q "${REF[$name]}" >/dev/null
  ok "pulled ${REF[$name]}"
done

if [[ $PULL_ONLY -eq 1 ]]; then
  printf 'API_IMAGE=%s\nWEB_IMAGE=%s\n' "${REF[api]}" "${REF[web]}"
  exit 0
fi

ENV="$DEPLOY/.env"
[[ -f "$ENV" ]] || fail "$ENV missing — run scripts/install.sh first"
set_env() {
  if grep -q "^$1=" "$ENV"; then sed -i "s|^$1=.*|$1=$2|" "$ENV"; else printf '%s=%s\n' "$1" "$2" >> "$ENV"; fi
}

title "Deploy"
OLD_API="$(sed -n 's/^API_IMAGE=//p' "$ENV")"
OLD_WEB="$(sed -n 's/^WEB_IMAGE=//p' "$ENV")"
if [[ "$OLD_API" == "${REF[api]}" && "$OLD_WEB" == "${REF[web]}" ]]; then
  ok "already on these digests"
fi
set_env API_IMAGE "${REF[api]}"
set_env WEB_IMAGE "${REF[web]}"
cd "$DEPLOY"
docker compose pull -q api web
docker compose up -d

WEB_PORT="$(sed -n 's/^WEB_PORT=//p' "$ENV")"; WEB_PORT="${WEB_PORT:-443}"
healthy() {
  local _
  for _ in $(seq 1 45); do
    curl -sk "https://127.0.0.1:${WEB_PORT}/api/health" | grep -q '"ok":true' && return 0
    sleep 2
  done
  return 1
}
if healthy; then
  ok "api answers through nginx — running ${REF[api]##*@} / ${REF[web]##*@}"
  exit 0
fi

# The new images do not come up: back to what ran before, if that was known.
if [[ -n "$OLD_API" && -n "$OLD_WEB" ]]; then
  note "the page does not answer — going back to the previous images"
  set_env API_IMAGE "$OLD_API"
  set_env WEB_IMAGE "$OLD_WEB"
  docker compose up -d
  healthy && fail "rolled back to $OLD_API / $OLD_WEB — the new images did not answer; docker compose logs"
fi
fail "the page does not answer — docker compose -f $DEPLOY/docker-compose.yml logs"
