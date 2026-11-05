# Assurance case

## Claim

On an installation that follows [`docs/install.md`](install.md), no
attacker named in the [threat model](threat-model.md) gets more than the
table there allows. Without the admin password nobody controls the node
through the dashboard, and nobody gets code of their choice to run on the
Pi through it.

The argument rests on four parts: a threat model with named trust
boundaries, secure design principles applied at each boundary, defences
against common implementation weaknesses, and checks in CI that keep these
in place.

## 1. Threat model and trust boundaries

[`docs/threat-model.md`](threat-model.md) lists the assets, five trust
boundaries, the attackers and the accepted risks.
[`ARCHITECTURE.md`](../ARCHITECTURE.md) shows the parts and what each runs
as. Each boundary and its control:

| Boundary | Control | Evidence |
|---|---|---|
| LAN to nginx | Only listener for others; ufw limits it to the LAN subnet; TLS 1.2 and 1.3 only | [`scripts/install.sh`](../scripts/install.sh) (ufw section), [`deploy/nginx/default.conf.template`](../deploy/nginx/default.conf.template), [ADR 0004](adr/0004-lan-only.md) |
| nginx to api | api binds 127.0.0.1 | `HOST` in [`deploy/docker-compose.yml`](../deploy/docker-compose.yml) and [`backend/src/config.ts`](../backend/src/config.ts) |
| api to bitcoind | RPC account limited to eight read-only methods | [ADR 0002](adr/0002-rpc-whitelist.md), `rpcwhitelist` in [`scripts/install.sh`](../scripts/install.sh) |
| api to host agent | Group-owned Unix socket, fixed list of actions | [ADR 0003](adr/0003-host-agent-fixed-actions.md), [`agent/btcnode-agent.py`](../agent/btcnode-agent.py) |
| CI and GHCR to the Pi | Image runs only after a cosign check of the CI identity, deployed by digest | [ADR 0001](adr/0001-signed-images-by-digest.md), [`scripts/deploy-pull.sh`](../scripts/deploy-pull.sh) |

## 2. Secure design principles

| Principle | How it is applied | Evidence |
|---|---|---|
| Least privilege | api runs as uid 1000, read-only root file system, `cap_drop: ALL`, `no-new-privileges`; host data mounted read-only. web keeps four capabilities. RPC account read-only. | [`deploy/docker-compose.yml`](../deploy/docker-compose.yml), [`deploy/Dockerfile.api`](../deploy/Dockerfile.api) |
| Fail-safe defaults | Without an agent socket, password hash and session key the control panel is off and its routes answer 404. api listens on 127.0.0.1 and sets the `secure` cookie flag unless told otherwise; the update check is off by default. A deploy aborts if a signature does not verify. | [`backend/src/app.ts`](../backend/src/app.ts) (`controlEnabled`), [`backend/src/config.ts`](../backend/src/config.ts), [`scripts/deploy-pull.sh`](../scripts/deploy-pull.sh) |
| Complete mediation | Every control request passes the CSRF header check, the session check and schema validation in the api, then the action check in the agent. | `/api/control` in [`backend/src/app.ts`](../backend/src/app.ts), `handle()` in [`agent/btcnode-agent.py`](../agent/btcnode-agent.py) |
| Economy of mechanism | The agent uses the Python standard library only and knows five requests. | [`agent/btcnode-agent.py`](../agent/btcnode-agent.py) |
| Separation of privilege | Reading is open in the LAN, control needs a login; root work happens only in the agent, outside the container. | [ADR 0003](adr/0003-host-agent-fixed-actions.md), [ADR 0004](adr/0004-lan-only.md) |
| Least common mechanism | api and agent share only the socket; the agent has no network (`IPAddressDeny=any`, `RestrictAddressFamilies=AF_UNIX`). | [`agent/btcnode-agent.service`](../agent/btcnode-agent.service) |
| Open design | All code, the threat model and the ADRs are public; no security depends on secrecy beyond the generated secrets. | this repository |
| Psychological acceptability | One installer sets up the RPC account, secrets, TLS and the firewall rule; one script updates with signature check and rollback. | [`scripts/install.sh`](../scripts/install.sh), [`scripts/deploy-pull.sh`](../scripts/deploy-pull.sh) |

## 3. Common implementation weaknesses

| Weakness | Defence | Evidence |
|---|---|---|
| Command injection (CWE-78) | No shell anywhere on the request path. The agent maps a fixed action to `subprocess.run` with an argument list; unit and container names come from its environment at start. The api runs helpers with `execFile` and argument lists built from code and configuration, never from a request. | [`agent/btcnode-agent.py`](../agent/btcnode-agent.py), [`backend/src/util/exec.ts`](../backend/src/util/exec.ts), [`agent/tests/test_agent.py`](../agent/tests/test_agent.py) |
| Improper input validation (CWE-20) | Request bodies, RPC replies, agent replies and the configuration are checked with zod schemas; the agent caps a request at 4096 bytes and rejects non-objects. | [`shared/src/control.ts`](../shared/src/control.ts), [`backend/src/rpc/schemas.ts`](../backend/src/rpc/schemas.ts), [`backend/src/control/agentClient.ts`](../backend/src/control/agentClient.ts), [`backend/src/config.ts`](../backend/src/config.ts) |
| Cross-site scripting (CWE-79) | Vue escapes all output; the frontend uses no `v-html`. nginx sends a CSP without inline script or style, plus `nosniff` and `frame-ancestors 'none'`. | [`deploy/nginx/default.conf.template`](../deploy/nginx/default.conf.template), [`frontend/src/`](../frontend/src/) |
| Cross-site request forgery (CWE-352) | Session cookie `SameSite=Strict` and `httpOnly`; every POST needs the header `x-requested-with: btcnode`, which a cross-site form cannot send. GET routes change nothing. | [`backend/src/app.ts`](../backend/src/app.ts), [`backend/test/app.test.ts`](../backend/test/app.test.ts) |
| Broken authentication (CWE-287, CWE-307) | bcrypt with cost 12; a missing hash still costs a compare. Login limited to five attempts per minute. Server-side sessions, regenerated on login, destroyed on logout, expiring after twelve hours. | [`backend/src/auth/password.ts`](../backend/src/auth/password.ts), [`backend/src/app.ts`](../backend/src/app.ts), [`backend/test/app.test.ts`](../backend/test/app.test.ts) |
| Exposure of secrets (CWE-200, CWE-798) | No secret in the repository or image; secrets are generated by the installer with `umask 077`, mounted read-only from `deploy/secrets/` and read from files. gitleaks scans the history. | [`scripts/install.sh`](../scripts/install.sh) (Secrets section), [`deploy/docker-compose.yml`](../deploy/docker-compose.yml), [`.github/workflows/scan.yml`](../.github/workflows/scan.yml) |
| Resource exhaustion (CWE-400) | RPC bodies read with a size limit and a timeout; helper processes run with timeouts and bounded output; control actions rate-limited. | [`backend/src/rpc/client.ts`](../backend/src/rpc/client.ts), [`backend/src/util/exec.ts`](../backend/src/util/exec.ts) |
| Vulnerable or tampered components (CWE-1395, CWE-494) | Lockfile installs, actions and base images pinned by SHA, Dependabot, Trivy on repository and images, cosign-signed images with SBOM and provenance; Bitcoin Core is installed only after checksum and developer signature checks. | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), [`.github/workflows/scan.yml`](../.github/workflows/scan.yml), [`.github/dependabot.yml`](../.github/dependabot.yml), [`scripts/node-setup/30-bitcoin-core.sh`](../scripts/node-setup/30-bitcoin-core.sh) |

## 4. Keeping it in place

- CI on every push and pull request: lint, type check, unit and property
  tests with coverage thresholds, agent tests, shellcheck, workflow lint, and
  a start of the web image with the production container settings
  ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)).
- Static analysis: CodeQL (GitHub default setup) for JavaScript and
  TypeScript, Python and Actions; Trivy, hadolint and gitleaks
  ([`.github/workflows/scan.yml`](../.github/workflows/scan.yml)); OpenSSF
  Scorecard ([`.github/workflows/scorecard.yml`](../.github/workflows/scorecard.yml)).
- `main` takes only signed commits with a linear history and green required
  checks.
- Vulnerability reports follow [`SECURITY.md`](../SECURITY.md).

## Known gaps

- The TLS certificate is self-signed; the first visit trusts it blindly.
- The agent runs as root, limited by its systemd sandbox.
- Everyone in the LAN can read the page.
- One maintainer, no second reviewer.
