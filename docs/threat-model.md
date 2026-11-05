# Threat model

## Assets

- Control of the node: restart bitcoind or electrs, reboot, power off.
- Secrets in `deploy/secrets/`: the RPC password, the admin password hash,
  the session key.
- What the page shows: onion address, peer addresses, the bitcoind journal.
- The host itself, through the agent that runs as root.

The dashboard holds no wallet and no keys. The RPC account cannot call
wallet methods.

## Trust boundaries

1. LAN to nginx (`web`): the only port anyone else sees.
2. nginx to the api: plain HTTP on 127.0.0.1.
3. api to bitcoind: an RPC account limited by `rpcwhitelist`.
4. api to the agent: a Unix socket owned by the group `btcnode`.
5. CI and GHCR to the Pi: images are only run after a signature check.

## Attackers

| Attacker                      | Gets                                                       | Stopped by                                                                               |
| ----------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Device in the LAN             | The read-only page, by design                              | Login (bcrypt, rate limit) before any control action                                     |
| Host on the internet          | Nothing                                                    | ufw limits 80 and 443 to the LAN subnet; no port forwarding                              |
| Foreign string in RPC or log  | Text on the page                                           | Vue escaping, CSP without inline script or style                                         |
| Cross-site request            | Nothing                                                    | `SameSite=Strict` cookie, custom-header CSRF check                                       |
| Compromised api process       | RPC reads, journal reads, the four agent actions           | RPC whitelist; the agent takes no free-form input                                        |
| Tampered image or dependency  | Code on the Pi                                             | cosign check of the CI identity before deploy; actions and base images pinned            |
| Pull request from a fork      | A CI run without secrets                                   | Publish and signing only on `main` and version tags                                      |

## Accepted risks

- Everyone in the LAN can read the page, including the onion address.
- The TLS certificate is self-signed; the first visit trusts it blindly.
- The agent runs as root. It is small, standard library only, and takes no
  arguments from the network.
