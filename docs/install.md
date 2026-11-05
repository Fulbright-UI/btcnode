# Install and operate

## What the page shows

The page shows what the node is doing: sync state, block height, fees, the
peers as a fan around your own node, who announced the last block first,
Core's own chain check against strangers, the Electrum index, temperature,
power supply, and the raw journal. Everything it reads it reads locally; it
never goes to the internet for a picture.

## What the installer does

`sudo bash scripts/install.sh` puts Docker in place if it is missing, installs
the agent, creates a read-only RPC account in `bitcoin.conf` (or reuses the
one an earlier dashboard had), asks for an admin password, makes a
self-signed certificate, writes `deploy/.env`, opens the port for the home
network only, and starts the containers on `https://<pi>/` (443, with 80
redirecting). The containers come as signed images from GHCR (see below);
`--build` builds them on the Pi from the checkout instead. If something else
already serves those ports, pass `--web-port 8443 --http-port 8080`.

It looks for `bitcoin.conf` in the usual places (`/mnt/bitcoin/bitcoin`,
`/var/lib/bitcoind`, `/home/bitcoin/.bitcoin`, `/data/bitcoin`); elsewhere,
run `sudo BITCOIN_DATA_DIR=/path/to/datadir bash scripts/install.sh`.

## bitcoind in Docker, or started some other way

The installer finds out how bitcoind runs: a systemd unit `bitcoind` (what
`scripts/node-setup` builds), else a Docker container, else it settles for
RPC and the data directory alone. The page then works; only the restart
button is not offered and the log comes from `debug.log`.

A node that runs as a container is found by its name or image (`bitcoin`,
`btc`; `sudo BITCOIND_CONTAINER=name bash scripts/install.sh` if it is called
something else). The data directory comes from the container's bind mounts,
the RPC account goes into that `bitcoin.conf`, and the container is restarted
instead of a unit, also later from the control panel, through the agent.
Two things the container must provide: its RPC port published on localhost
(`-p 127.0.0.1:8332:8332` or `network_mode: host`; the installer checks and
says so), and a group-readable `debug.log` in the data directory, which then
replaces the journal as the log source (`LOG_SOURCE=file`). An Electrum
server in a container (`electrs`, `fulcrum`, `electrumx`) is picked up the
same way; without one the page says so.

## Images, signatures, updates

CI builds both images for `linux/arm64` and, from `main` and version tags,
publishes them as `ghcr.io/fulbright-ui/btcnode-api` and
`ghcr.io/fulbright-ui/btcnode-web` (tags `main`, `sha-<commit>`, and the
version for tags). Each image is signed with cosign (keyless: the
certificate names this repository's `ci.yml` workflow) and carries an SBOM
(SPDX) and SLSA build provenance.

The Pi deploys with

```bash
sudo bash scripts/deploy-pull.sh            # tag main; --tag sha-1234567 for a given commit
```

which resolves the tag to a digest, checks the signature of exactly that
digest, and only then writes the digests into `deploy/.env`, pulls and
restarts; if the page does not come back it returns to the previous digests.
It installs cosign itself when it is missing: a pinned release, checked
against its SHA-256 (`--install-cosign` does only that). The check by hand is
in the [README](../README.md#verify).

The attestations can also be read with
`gh attestation verify oci://ghcr.io/fulbright-ui/btcnode-api@sha256:<digest> -R Fulbright-UI/btcnode`.
To build on the Pi instead: `sudo bash scripts/install.sh --build`, or
`docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`
in `deploy/`.

## Configuration

The backend reads its environment (validated at start: a wrong value fails
loudly instead of freezing the page). `deploy/.env.example` lists the knobs;
`backend/src/config.ts` is the authority. Secrets (`rpc_password`,
`admin_password_hash`, `session_key`) live as files in `deploy/secrets/`.

## What the page publishes

Anyone on the network who can open the page sees your node's onion address,
every peer address, the full journal of bitcoind, and, only after logging in,
may restart services, reboot or shut the Pi down. The installer limits the
port to your LAN subnet when ufw is active; do not forward it.

## Security details

The api container is read-only, runs unprivileged, drops all capabilities,
joins two host groups (`systemd-journal` to read the log, `btcnode` for the
agent socket) plus, for a bitcoind in a container, the group that owns the
data directory, and mounts the journal, the data directory (for the
disk figure; the chain itself stays unreadable) and the agent socket. The
RPC account may call eight read-only methods; `rpcwhitelistdefault=0` blocks
the rest. The agent is the only privilege on the host: it accepts four fixed
actions and a status query over a group-protected Unix socket and refuses
everything else. No unit name, no argument, no shell ever comes from the
network. The control routes sit behind a bcrypt password, a server-side
session cookie (`HttpOnly`, `Secure`, `SameSite=Strict`), a custom-header
CSRF check and a rate limit. Sessions live in the api process's memory:
restarting or rebuilding the container logs the admin out, which is
intended, since there is nothing on disk to steal. The page itself ships
with no inline script or style, so the CSP starts with
`default-src 'none'; script-src 'self'; style-src 'self'`.
