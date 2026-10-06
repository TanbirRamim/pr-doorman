# Security policy

## Supported versions

Only the latest release gets fixes.

## Reporting a problem

Please don't open a public issue. Use [private vulnerability reporting](https://github.com/TanbirRamim/pr-doorman/security/advisories/new) on this repo, or email contact.tanbirramim@gmail.com. I'll reply within a week.

## Design notes

pr-doorman is meant to run on `pull_request_target`, which has a write token. To keep that safe it never checks out or runs code from the pull request. It only reads PR metadata through the GitHub API: the body, author, labels, file names and line counts. Text from the PR and issue is treated as data and is only matched against regexes.

If you find a way to make it run untrusted code, leak the token, or get a comment rendered with content that could mislead maintainers, that's a security issue and I'd like to hear about it.
