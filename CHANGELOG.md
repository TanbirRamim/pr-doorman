# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/).

## [Unreleased]

### Changed

- The action now runs on the `node24` runtime instead of `node20`, which GitHub has deprecated for actions. Self-hosted runners need runner v2.327.1 or newer.
- Upgraded `@actions/core` to 3.x and `@actions/github` to 9.x. Both are ESM-only now, so the TypeScript config uses `module: preserve` with `moduleResolution: bundler`; the bundled `dist/` output is unchanged in behavior.
- Dropped the `undici` override; the toolkit now depends on a patched version directly.

## [0.1.0]

First release.

- Checks: `linked-issue`, `claim`, `pr-burst`, `template`, `account`, `diff-scope`, each with a severity of `off`, `note`, `warn` or `fail`.
- One sticky comment per PR that explains each problem and how to fix it, updated in place.
- Labels for flagged checks, removed again once they pass.
- `dry-run`, `close-on-fail`, `fail-job`, allowlists, and skipping of owners, members, collaborators and bots.
- Outputs: `result`, `failed-checks`, `flagged-checks`, `labels`.
