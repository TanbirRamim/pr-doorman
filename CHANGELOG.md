# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/).

## [Unreleased]

## [0.1.0]

First release.

- Checks: `linked-issue`, `claim`, `pr-burst`, `template`, `account`, `diff-scope`, each with a severity of `off`, `note`, `warn` or `fail`.
- One sticky comment per PR that explains each problem and how to fix it, updated in place.
- Labels for flagged checks, removed again once they pass.
- `dry-run`, `close-on-fail`, `fail-job`, allowlists, and skipping of owners, members, collaborators and bots.
- Outputs: `result`, `failed-checks`, `flagged-checks`, `labels`.
