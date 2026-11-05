# Development

## Parts

| Directory   | What                                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `frontend/` | The page. Vue 3, Vite, TypeScript, Pinia, vue-i18n (`en`, `de`). Own SVG components.                                         |
| `backend/`  | Collector and API. Node 22, Fastify, TypeScript, zod. Polls the node, judges, serves.                                        |
| `shared/`   | The contract between the two: zod schemas of the status snapshot, thresholds, actions.                                       |
| `agent/`    | The host agent: Python 3 (standard library), runs as root, knows exactly four actions and a status query.                    |
| `deploy/`   | Docker Compose, the two Dockerfiles, nginx with TLS and a strict CSP.                                                        |
| `scripts/`  | `install.sh` and `deploy-pull.sh` for the dashboard; `node-setup/` builds the node itself (disk, Core, electrs, Tor, I2P). |

## Run it locally

```bash
pnpm install
pnpm --filter ./shared build
pnpm --filter ./backend mock       # a full dashboard against a mock node on http://127.0.0.1:3000/
pnpm --filter ./frontend dev       # Vite dev server, proxies /api to :3000
pnpm check                         # lint, typecheck, tests, build
```

## Mock scenarios

`MOCK_SCENARIO=syncing` or `empty` shows the initial sync and an empty node.
The mock is a real HTTP JSON-RPC server with Basic Auth, and unknown methods
answer 403 like a missing whitelist entry would; the same client code runs
there as against the Pi. The agent has its own tests
(`python3 -m unittest agent/tests/test_agent.py`), the setup scripts theirs
(`scripts/node-setup/tests/check.sh`).

## CI

CI (`.github/workflows/ci.yml`) runs on every branch and pull request:
`pnpm check`, `agent and scripts`, `workflow lint`, `image api (linux/arm64)`,
`image web (linux/arm64)`; `publish api` and `publish web` only on `main` and
tags. Actions are pinned by commit SHA, base images by digest.

## The status contract

`GET /api/status` returns facts, not sentences: numbers, unix seconds, bytes,
sat/vB, fractions, and warning _codes_. Wording, number notation and dates
belong to the frontend and its locale files. `shared/src/status.ts` is the
schema; the backend validates every snapshot against it before serving it.

## Language

The page follows the browser, `?lang=de` or `?lang=en` overrides, the footer
remembers the choice.
