# 0001: Signed GHCR images, deployed by digest

Status: accepted

## Context

Building the images on the Pi takes several minutes and needs the whole
toolchain there. A pulled image has to be the one this repository's CI
built, not whatever a tag points to at the moment.

## Decision

CI builds `btcnode-api` and `btcnode-web` for linux/arm64 and publishes them
to GHCR from `main` and version tags only. Each image is signed with cosign
(keyless, the certificate names `.github/workflows/ci.yml` and the ref) and
carries an SBOM and build provenance. `scripts/deploy-pull.sh` resolves the
tag to a digest, verifies the signature against that identity, writes the
digests to `deploy/.env` and rolls back if the page does not answer.

## Consequences

- The Pi runs only digests CI signed; a moved tag changes nothing.
- cosign has to be installed on the Pi (checksum-checked by the script).
- `docker-compose.build.yml` stays as the fallback when GHCR is unreachable.
