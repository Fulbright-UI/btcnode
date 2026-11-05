# btcnode

A dashboard and a small control panel for a self-hosted Bitcoin full node on a
Raspberry Pi — Bitcoin Core, an Electrum server, Tor. Two containers, one
tiny host agent, and the scripts that set the node up in the first place.

The page shows what the node is doing: sync state, block height, fees, the
peers as a fan around your own node, who announced the last block first,
Core's own chain check against strangers, the Electrum index, temperature,
power supply, and the raw journal. Everything it reads it reads locally; it
never goes to the internet for a picture.

```
browser ──443──► nginx (web container) ──► static page (Vue)
                      │
                      └── /api ──► backend (api container)
                                      │  reads   bitcoind RPC (read-only account)
                                      │  reads   the systemd journal
                                      │  reads   /proc, /sys, electrs
                                      └─ control ─► host agent (Unix socket, 4 actions)
                                                       └─► systemctl restart / reboot / poweroff
```

## Parts

| Directory   | What                                                                                  |
| ----------- | ------------------------------------------------------------------------------------- |
| `frontend/` | The page. Vue 3, Vite, TypeScript, Pinia, vue-i18n (`en`, `de`). Own SVG components.  |
| `backend/`  | Collector and API. Node 22, Fastify, TypeScript, zod. Polls the node, judges, serves.  |
| `shared/`   | The contract between the two: zod schemas of the status snapshot, thresholds, actions. |
| `agent/`    | The host agent: Python 3 (standard library), runs as root, knows exactly four actions. |
| `deploy/`   | Docker Compose, the two Dockerfiles, nginx with TLS and a strict CSP.                 |
| `scripts/`  | `install.sh` and `deploy-pull.sh` for the dashboard; `node-setup/` builds the node itself (disk, Core, electrs, Tor). |

## Install on the Pi

Set the node up first (`scripts/node-setup/README.md`), then:

```bash
git clone https://github.com/Fulbright-UI/btcnode.git
cd btcnode
sudo bash scripts/install.sh
```

The installer puts Docker in place if it is missing, installs the agent,
creates a read-only RPC account in `bitcoin.conf` (or reuses the one an
earlier dashboard had), asks for an admin password, makes a self-signed
certificate, writes `deploy/.env`, opens the port for the home network only,
and starts the containers on **https://<pi>/** (443, with 80 redirecting).
The containers come as signed images from GHCR (next section); `--build`
builds them on the Pi from the checkout instead.
If something else already serves those ports, pass `--web-port 8443
--http-port 8080`.
It looks for `bitcoin.conf` in the usual places (`/mnt/bitcoin/bitcoin`,
`/var/lib/bitcoind`, `/home/bitcoin/.bitcoin`, `/data/bitcoin`); elsewhere,
run `sudo BITCOIN_DATA_DIR=/path/to/datadir bash scripts/install.sh`.

### bitcoind in Docker, or started some other way

The installer finds out how bitcoind runs: a systemd unit `bitcoind` (what
`scripts/node-setup` builds), else a Docker container, else it settles for
RPC and the data directory alone — the page then works, only the restart
button is not offered and the log comes from `debug.log`.

A node that runs as a container is found by its name or image (`bitcoin`,
`btc`; `sudo BITCOIND_CONTAINER=name bash scripts/install.sh` if it is called
something else). The data directory comes from the container's bind mounts,
the RPC account goes into that `bitcoin.conf`, and the container is restarted
instead of a unit — also later from the control panel, through the agent.
Two things the container must provide: its RPC port published on localhost
(`-p 127.0.0.1:8332:8332` or `network_mode: host`; the installer checks and
says so), and a group-readable `debug.log` in the data directory, which then
replaces the journal as the log source (`LOG_SOURCE=file`). An Electrum
server in a container (`electrs`, `fulcrum`, `electrumx`) is picked up the
same way; without one the page says so.

### Images, signatures, updates

CI builds both images for `linux/arm64` and, from `main` and version tags,
publishes them as `ghcr.io/fulbright-ui/btcnode-api` and
`ghcr.io/fulbright-ui/btcnode-web` (tags `main`, `sha-<commit>`, and the
version for tags). Each image is signed with cosign — keyless: the
certificate names this repository's `ci.yml` workflow — and carries an SBOM
(SPDX) and SLSA build provenance.

The Pi deploys with

```bash
sudo bash scripts/deploy-pull.sh            # tag main; --tag sha-1234567 for a given commit
```

which resolves the tag to a digest, checks the signature of exactly that
digest, and only then writes the digests into `deploy/.env`, pulls and
restarts; if the page does not come back it returns to the previous digests.
It installs cosign itself when it is missing: a pinned release, checked
against its SHA-256 (`--install-cosign` does only that). The check, by hand:

```bash
cosign verify ghcr.io/fulbright-ui/btcnode-api@sha256:<digest> \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github\.com/Fulbright-UI/btcnode/\.github/workflows/ci\.yml@refs/(heads/main|tags/v[0-9]+\.[0-9]+\.[0-9]+)$'
```

The attestations can also be read with
`gh attestation verify oci://ghcr.io/fulbright-ui/btcnode-api@sha256:<digest> -R Fulbright-UI/btcnode`.
To build on the Pi instead: `sudo bash scripts/install.sh --build`, or
`docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`
in `deploy/`.

Language: the page follows the browser, `?lang=de` / `?lang=en` overrides,
the footer remembers the choice.

## What the page publishes

Anyone on the network who can open the page sees your node's onion address,
every peer address, the full journal of bitcoind, and — only after logging in
— may restart services, reboot or shut the Pi down. The installer limits the
port to your LAN subnet; do not forward it.

## Security, in one paragraph

The api container is read-only, runs unprivileged, drops all capabilities,
joins exactly two host groups (`systemd-journal` to read the log, `btcnode`
for the agent socket), and mounts the journal, the data directory (for the
disk figure — the chain itself stays unreadable) and the agent socket. The
RPC account may call eight read-only methods; `rpcwhitelistdefault=0` blocks
the rest. The agent is the only privilege on the host: it accepts four fixed
actions over a group-protected Unix socket and refuses everything else — no
unit name, no argument, no shell ever comes from the network. The control
routes sit behind a bcrypt password, a server-side session cookie
(`HttpOnly`, `Secure`, `SameSite=Strict`), a custom-header CSRF check and a
rate limit. Sessions live in the api process's memory: restarting or
rebuilding the container logs the admin out, which is intended — there is
nothing on disk to steal. The page itself ships with no inline script or
style, so the CSP is `default-src 'none'; script-src 'self'; style-src 'self'`.

## Develop

```bash
pnpm install
pnpm --filter ./shared build
pnpm --filter ./backend mock       # a full dashboard against a mock node on http://127.0.0.1:3000/
pnpm --filter ./frontend dev       # Vite dev server, proxies /api to :3000
pnpm check                         # lint, typecheck, tests, build — what CI runs
```

CI (`.github/workflows/ci.yml`) runs on every branch and pull request:
`pnpm check`, `agent and scripts`, `workflow lint`, `image api (linux/arm64)`,
`image web (linux/arm64)`; `publish api` / `publish web` only on `main` and
tags. Actions are pinned by commit SHA, base images by digest.

`MOCK_SCENARIO=syncing` or `empty` shows the initial sync and an empty node.
The mock is a real HTTP JSON-RPC server with Basic Auth, and unknown methods
answer 403 like a missing whitelist entry would — the same client code runs
there as against the Pi. The agent has its own tests
(`python3 -m unittest agent/tests/test_agent.py`), the setup scripts theirs
(`scripts/node-setup/tests/check.sh`).

### Configuration

The backend reads its environment (validated at start — a wrong value fails
loudly instead of freezing the page). `deploy/.env.example` lists the knobs;
`backend/src/config.ts` is the authority. Secrets (`rpc_password`,
`admin_password_hash`, `session_key`) live as files in `deploy/secrets/`.

### The status contract

`GET /api/status` returns facts, not sentences: numbers, unix seconds, bytes,
sat/vB, fractions, and warning *codes*. Wording, number notation and dates
belong to the frontend and its locale files. `shared/src/status.ts` is the
schema; the backend validates every snapshot against it before serving it.

## License

MIT — see `LICENSE`.
