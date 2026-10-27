---
Category: the #1833 github-create gate shipped a filesystem mkdir that does not repair an existing directory's mode, so a chmod-0500 ~/.cairn/github-create made every server-side issue create throw raw EACCES as an opaque 500 while the creation-time mirror swallowed it silently
Source: card #100 (2026-10-27)
Level: 2
Safeguard: the gate throws GithubCreateGateNotWritableError naming the directory and the remedy on EACCES/EPERM/EROFS at both mkdir sites, githubCreateIssue maps it to HttpError 503, and scheduleSelfIssueCreate logs the failure; unit and route tests drive a real chmod-0500 directory
Intercepts: 0
Recurrences: 0
Notes: the negative control is the real production error: the red run in docs/verify/100/red-run.txt shows the live failure shape (raw EACCES from the gate, 500 from the retry route, zero mirror logs) going red under the new tests before the fix. Also caught here: packages/shared/src/github-create-gate.ts is imported directly by scripts/lib/github-create-gate.mjs under node strip-only TypeScript, so constructor parameter properties (TS-only syntax) break the bot CLI wrapper; the error class uses explicit field declarations.
---
