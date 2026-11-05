# 0002: Eight read-only RPC methods

Status: accepted

## Context

The api needs chain, network, mempool, peer and fee figures from bitcoind.
A full RPC account could also reach the wallet, stop the node or change
its network settings.

## Decision

The installer creates its own RPC account `dashboard` (`rpcauth`) and
limits it with `rpcwhitelist` to `getblockchaininfo`, `getnetworkinfo`,
`getmempoolinfo`, `uptime`, `getpeerinfo`, `getblockstats`,
`getnetworkhashps` and `estimatesmartfee`. `rpcwhitelistdefault=0` keeps
every other account's rights unchanged.

## Consequences

- A leaked RPC password or a compromised api can only read.
- A new figure that needs another method means a change to the list in
  `scripts/install.sh` and `scripts/node-setup/30-bitcoin-core.sh`, and a
  restart of bitcoind. The mock node answers 403 to unknown methods, so
  tests notice the gap.
