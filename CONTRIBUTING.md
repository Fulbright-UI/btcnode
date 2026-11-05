# Contributing

## Bugs and ideas

Open an [issue](https://github.com/Fulbright-UI/btcnode/issues). Say what you
did, what you expected and what happened, with the dashboard version from the
page footer.

Security problems go through [SECURITY.md](SECURITY.md), not through issues.

## Pull requests

- One topic per pull request, based on the latest `main`.
- Commits are signed (SSH or GPG). `main` takes signed commits and a linear
  history only, so a pull request is rebased, not merged.
- CI must be green. Run `pnpm check` before you push; it is the same as the
  CI job of that name. See [docs/development.md](docs/development.md).
- New functions come with tests. Pure functions get a property test with
  fast-check where it fits.
- Workflow changes keep actions pinned by commit SHA and permissions minimal.

## Style

- Commit subject: at most 60 characters, imperative, `area: change`, for
  example `backend: reject empty RPC replies`.
- Text in English, short and plain. No dashes as sentence breaks, no emojis,
  no marketing words.
- Code formatting is Prettier and ESLint as configured; `pnpm check` tells
  you.

By contributing you agree that your work is published under the
[MIT license](LICENSE).
