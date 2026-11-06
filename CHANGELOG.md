# Changelog

All notable changes are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `SECURITY.md` describes the handling of reports, target times and credit.
- A roadmap and an assurance case in `docs/`.
- Tests for the update check, the agent and RPC clients, the notices, the
  stores and the Vue components. Statement coverage: backend 88 %,
  frontend 99 %; the thresholds sit just below.
- `repro` workflow with `scripts/repro-js.sh` and `scripts/repro-image.sh`:
  builds the JavaScript and both images twice and compares them, weekly
  and when a Dockerfile or the lockfile changes.

### Changed

- The ping notice judges each network on its own: median per network,
  limits of 1 s for IPv4, IPv6 and CJDNS, 3 s for Tor and 5 s for I2P, and
  only with at least three measured peers. It was the mean over all peers
  and called "own response time", so one stalled I2P peer could raise it.
  The warning code is now `peerLatencySlow` with `network` and `ms`.
- Images are reproducible for a given commit and package mirror state: the
  publish job sets `SOURCE_DATE_EPOCH` from the commit and rewrites the
  layer timestamps; build logs, the ldconfig cache, the machine-id and
  pnpm's `.modules.yaml` are no longer part of the images.

## [4.0.0] - 2026-11-05

First tagged release.

### Added

- Dashboard as a Vue page and a Fastify api in two containers, with a
  control panel behind a login.
- Host agent with fixed actions for restarts, reboot and power off.
- Support for a bitcoind in Docker or without a systemd unit.
- Setup scripts for the node itself, Tor and I2P included.
- Signed linux/arm64 images on GHCR (Node 26 LTS, nginx 1.31) with SBOM
  and provenance; `scripts/deploy-pull.sh` checks the signature first.
- The web container runs read-only with four capabilities.
- CI with pinned actions and images, Scorecard, Dependabot and security
  scanners (see `.github/workflows/`).
- Property tests, coverage thresholds and an end-to-end check with axe.
- `ARCHITECTURE.md`, a threat model and ADRs in `docs/`.

[Unreleased]: https://github.com/Fulbright-UI/btcnode/compare/v4.0.0...HEAD
[4.0.0]: https://github.com/Fulbright-UI/btcnode/releases/tag/v4.0.0
