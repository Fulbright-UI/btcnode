# btcnode

[![CI](https://github.com/Fulbright-UI/btcnode/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Fulbright-UI/btcnode/actions/workflows/ci.yml?query=branch%3Amain) [![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/Fulbright-UI/btcnode/badge)](https://scorecard.dev/viewer/?uri=github.com/Fulbright-UI/btcnode) [![License: MIT](https://img.shields.io/github/license/Fulbright-UI/btcnode)](LICENSE)

Dashboard and control panel for a Bitcoin full node on a Raspberry Pi.
Bitcoin Core, electrs, Tor and I2P.

```
browser ──443──► nginx (web) ──► Vue
                  └── /api ──► api ──► bitcoind RPC (read-only account)
                                  ├──► journal, /proc, /sys, electrs
                                  └──► host agent (unix socket, 4 actions)
```

## Install

Set up the node first: [`scripts/node-setup/`](scripts/node-setup/). Then:

```bash
git clone https://github.com/Fulbright-UI/btcnode.git
cd btcnode
sudo bash scripts/install.sh
```

Serves on `https://<pi>/`. With ufw active the installer opens the port to the
LAN only. Flags: `--web-port`, `--http-port`, `--build` to build on the Pi
instead of pulling. Other setups: [`docs/install.md`](docs/install.md).

## Update

```bash
sudo bash scripts/deploy-pull.sh
```

Resolves the tag to a digest, verifies the signature, pulls, rolls back if
the page does not come up.

## Verify

`ghcr.io/fulbright-ui/btcnode-{api,web}`, linux/arm64, signed keyless with
cosign, SBOM and SLSA provenance attached.

```bash
cosign verify ghcr.io/fulbright-ui/btcnode-api@sha256:<digest> \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github\.com/Fulbright-UI/btcnode/\.github/workflows/ci\.yml@refs/(heads/main|tags/v[0-9]+\.[0-9]+\.[0-9]+)$'
```

## Security

- api container: read-only, unprivileged, no capabilities.
- RPC account limited to eight read-only methods.
- Host agent: four fixed actions and a status query over a group-protected socket. Nothing from the network reaches a shell.
- Control panel: bcrypt, server-side sessions, CSRF check, rate limit.
- CSP without inline script or style.
- The page shows the onion address, all peers and the journal. Keep it on the LAN.

Vulnerabilities: see [`SECURITY.md`](SECURITY.md). Threat model:
[`docs/threat-model.md`](docs/threat-model.md).

## Develop

```bash
pnpm install
pnpm --filter ./shared build
pnpm --filter ./backend mock   # dashboard against a mock node on :3000
pnpm check                     # same as the CI job
```

More in [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`docs/`](docs/).

## License

MIT
