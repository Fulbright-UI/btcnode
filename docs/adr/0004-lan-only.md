# 0004: Reachable from the LAN only

Status: accepted

## Context

The page shows the onion address, peer addresses and the bitcoind journal
without a login, and offers control actions after one.

## Decision

The dashboard is meant for the home network. Both containers use the host
network so that RPC, electrs and the metrics port stay on 127.0.0.1. With
ufw active, `scripts/install.sh` opens the web ports only for the LAN
subnet. There is no port forwarding and no remote access built in.

## Consequences

- Nothing from the internet reaches the page or the api.
- Everyone in the LAN can read the page; only control actions need the
  password.
