# Roadmap

November 2026 to November 2027. These are intentions of a one-person
project, not commitments. Quarters say roughly when, not by when.

## Q4 2026

- Colour contrast to WCAG 2.1 AA, then switch the axe rule `color-contrast`
  back on in [`e2e/dashboard.spec.ts`](../e2e/dashboard.spec.ts).
- Make the end-to-end job a required check once it has run stable for a
  while.

## Q1 2027

- More frontend tests and higher coverage thresholds in
  [`frontend/vitest.config.ts`](../frontend/vitest.config.ts); the backend
  thresholds follow as tests are added.
- Drop the `glob` and `minimatch` overrides in `pnpm-workspace.yaml` once the
  packages that pull them in have moved on.

## Q2 2027

- Reproducible image builds: fixed timestamps in the build, then a CI job
  that builds twice and compares the digests.

## Throughout

- Releases follow [Semantic Versioning](https://semver.org/), as signed tags
  with a [CHANGELOG](../CHANGELOG.md) entry; `release.yml` publishes them.
- Bitcoin Core and electrs: patch releases soon after they appear, major
  releases after the release notes have been read, both through the
  versions pinned in [`scripts/node-setup/`](../scripts/node-setup/) and
  with the signature checks there.
- Dependency, base image and action updates through Dependabot, weekly.
- Security reports as in [`SECURITY.md`](../SECURITY.md).

## Not planned

Wallet functions ([threat model](threat-model.md)) and access from the
internet ([ADR 0004](adr/0004-lan-only.md)). Changing that is the
maintainer's call ([`GOVERNANCE.md`](../GOVERNANCE.md)).
