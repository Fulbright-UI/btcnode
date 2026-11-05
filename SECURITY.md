# Security

## Reporting

Report vulnerabilities privately through GitHub:
[Report a vulnerability](https://github.com/Fulbright-UI/btcnode/security/advisories/new).
Please do not open a public issue for them.

## Supported versions

The latest release and the latest commit on `main`. Fixes go to `main` and
into the next release; older releases get no backports.

## What happens after a report

This is a one-person project, so the times below are targets, not promises.

1. Acknowledgement within 14 days.
2. Assessment: whether it is a vulnerability, how severe it is and which
   versions it affects. You hear the result in the advisory thread.
3. Fix on `main` and a new release within 90 days of the report. If that is
   not possible, we agree on a later date with you.
4. Coordinated disclosure: the advisory is published on GitHub once the fix
   is released, with a CVE where it applies. The CHANGELOG names the fix.

You may publish your findings after the advisory is out, or after 90 days
if no fix has come and no later date was agreed.

## Credit

Reporters are credited in the advisory and in the CHANGELOG if they wish,
under the name they choose. Anonymous reports are fine.

## Background

[`docs/threat-model.md`](docs/threat-model.md) and
[`docs/assurance-case.md`](docs/assurance-case.md) describe what the project
defends against and how.
