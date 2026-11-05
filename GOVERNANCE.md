# Governance

## Roles

- Maintainer: the project owner, the GitHub account
  [Fulbright-UI](https://github.com/Fulbright-UI). The maintainer decides on
  direction, releases, the license and write access, and handles security
  reports.
- Assistant: an automated assistant works on behalf of the maintainer. It
  writes code and documentation, keeps dependencies current and pushes
  signed commits under the maintainer's account. It does not decide alone on
  direction or the license; such changes need the maintainer's consent.
- Contributors: anyone who opens an issue or a pull request. See
  [CONTRIBUTING.md](CONTRIBUTING.md) and the
  [Code of Conduct](CODE_OF_CONDUCT.md).

## Decisions

The maintainer decides. Proposals and discussion happen in public issues
and pull requests. Design decisions are recorded as ADRs in
[`docs/adr/`](docs/adr/). A change lands on `main` only as signed commits
with a linear history and green required checks.

## Becoming a maintainer

There is one maintainer today. Someone who has contributed good changes over
a longer time can be offered review or write access by the maintainer. The
maintainer grants and removes access and records it in this file.

## Continuity

The bus factor is one. If the maintainer is unavailable, nobody else can
merge or cut releases. The project stays usable anyway:

- The code is public and MIT licensed, so anyone may fork and continue it.
- Images are signed keyless by the CI workflow. A fork builds and signs its
  own images; `scripts/deploy-pull.sh` keeps the registry namespace and the
  signing identity in two variables at the top.
- Setup is described in [`docs/`](docs/) and
  [`ARCHITECTURE.md`](ARCHITECTURE.md). Images and releases are built by the
  workflows in [`.github/workflows/`](.github/workflows/), not on a private
  machine.

Nodes already installed keep running without the project; they only stop
getting updates.
