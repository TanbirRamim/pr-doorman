# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/).

## [Unreleased]

### Added

- A claimer can give up a comment claim with phrases like "unassign me" or "no longer working on this", and the claim ends right away instead of waiting to expire. Extra phrases go in the new `release-phrases` input (#8).

## [0.3.0]

### Added

- `assignment-expiry` input (off by default). When on, an assignment expires `claim-expiry-days` after the assignee was assigned or last commented, read from the issue timeline. One extra API call, only when the claim check is on and the issue has assignees.

## [0.2.1]

### Changed

- Shorter action description so the action can be listed on the GitHub Marketplace.

## [0.2.0]

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
