# 0003: Host agent with fixed actions

Status: accepted

## Context

Restarting bitcoind or electrs, rebooting and powering off need root on the
host. The api container should have no privileges at all.

## Decision

`agent/btcnode-agent.py` runs as root on the host and listens on a Unix
socket owned by the group `btcnode`. It accepts one JSON line per
connection and knows `status`, `restart-bitcoind`, `restart-electrs`,
`reboot` and `poweroff`. Units and container names are fixed at start; no
unit name, argument or shell string comes from the request. It uses the
Python standard library only.

## Consequences

- The api container joins the group `btcnode` and gets nothing else on the
  host.
- A new action needs a change to the agent and a reinstall on the host.
