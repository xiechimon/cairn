---
Category: A Claude Code auth fixture called the native login method oauth_token, so an expiry fix selected the wrong credential source
Source: #1845 (2026-10-27)
Level: 2
Safeguard: Machine login tests exercise the CLI's native claude.ai method and an oauth_token alternative against a stale OAuth clock
Intercepts: 1
Recurrences: 0
Notes: Negative control: the previous predicate reports native login as ok without its expiry and reports the alternative as expired; see docs/verify/1845/cli-contract-red.log
---
