# Contributing

Thanks for wanting to help. This is a small project, so the process is light.

## Claim an issue first

This project exists because two people ended up building the same fix, so please:

1. Find an issue (or open one if what you want to do isn't tracked yet).
2. Comment that you'd like to work on it, something like "I'd like to work on this".
3. Wait for a maintainer to reply before you start. Usually that's a day or two.
4. Open your PR with `Closes #<number>` in the description.

If you claimed something and can't finish it, just say so on the issue. That's completely fine. A claim with no activity for 7 days is treated as free again.

Typo fixes and small doc changes don't need an issue.

## Development

You need Node 24 or newer.

```sh
npm ci
npm run all   # lint, typecheck, test, build
```

The code is split in two:

- `src/checks/` holds one pure function per check. They take plain data and return a result, with no API calls, so they're easy to test. Tests are in `test/`.
- `src/github.ts` does all the API calls and builds the `Facts` object the checks read. `src/main.ts` wires it together and does the writing (comment, labels, closing).

If you add a check, add it to `CHECK_IDS` in `src/types.ts`, give it a default in `src/config.ts`, an input in `action.yml`, a row in the README, and tests for the flagged and passing cases plus whatever edge cases you can think of.

## dist/

GitHub runs the action from `dist/index.js`, so it's committed. `npm run all` rebuilds it, and CI fails if it's out of date. Please commit the rebuilt `dist/` with your change.

## Rules for new checks

pr-doorman only does things you can explain in one or two sentences to the person being flagged. No AI, no scores made of many weighted signals, no calls to services other than GitHub. Every flag needs a "here's how to fix it" message written for a contributor who's trying in good faith.

## Releases

Maintainers tag `vX.Y.Z` and move the `v0` (later `v1`) major tag. Release notes are generated from PR labels, see `.github/release.yml`.
