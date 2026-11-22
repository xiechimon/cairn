# Verified GitHub localPath reads (#3707)

## Bug class

A GitHub project row may still carry `localPath` (legacy rows were cleared by migration, but `connect_repo` retains the path when a local project is converted to `repoKind: 'github'`). The checkout on disk is owned by the user: they can repoint `remote.origin.url` from repository A to repository B at any time. Before the next fetch, the checkout still holds A's `HEAD`, branches, tags and object database. A reader that trusts only the URL string serves A's objects as if they were B's — the stale-identity bug that forced the cache-only split in #3494.

## Readers

On current main the directory-reading surface is `readFile`, `readFiles`, and the Coordinator `docs` tool and memory import on top of them. `readTree`, `readCommitHistory` and `readCommitDetail` were retired with the project browser APIs in #3758. The verification helper lives in the shared `resolveReadCommit` path, so every present or future reader that resolves a commit through it inherits the proof.

## Provenance proof for a local checkout

A `localPath` checkout is a verified source only when both halves hold:

1. **Remote URL** — `remote.origin.url` normalizes to the project's bound clone URL (`githubCloneUrl(binding)`), the same `requireGithubRepoIdentity` check the workspace cache already uses.
2. **Fetched object identity** — `.git/FETCH_HEAD` must contain at least one entry whose recorded URL normalizes to the *effective* origin URL (`git ls-remote --get-url origin`, which applies `url.*.insteadOf`). Git rewrites `FETCH_HEAD` on every `fetch`/`pull` with `<sha>\t[not-for-merge]\t<branch|tag> '<name>' of <url>` lines, so it is the checkout's own record of what the current remote actually delivered.

The matching entries form the proven set: recorded `{kind, name, sha}` tips plus the single for-merge tip.

## Serving rule

A requested ref resolves against the proven set first: a recorded branch/tag name maps to its recorded sha, and `HEAD` prefers the for-merge sha. Ambient refs (local `HEAD`, `refs/heads/*`, `refs/remotes/origin/*`, `refs/tags/*`, raw SHAs) may resolve only to a commit that is `git merge-base --is-ancestor` of a proven tip — those objects demonstrably arrived with a recorded fetch. Everything else is unverified. This mirrors the cache's `refs/cairn/repositories/<hash>` namespace: the prefix there and the `FETCH_HEAD` set here are the same "fetched from the bound origin" boundary.

## Source order and failure handling

Per read: **proven localPath → verified workspace cache → GitHub API**.

- localPath absent, not a repo, origin mismatch, or no `FETCH_HEAD` entries from the effective URL → skip to cache.
- localPath proven but the requested ref is missing or unverified → skip to cache.
- Cache keeps its existing hard verdicts (403 unverified, 404 missing); with no cache root the API is the fallback.
- Never serve content whose fetch provenance cannot be shown.

| Scenario | Result |
| --- | --- |
| Ref fetched from the current origin | Served from localPath at the recorded sha |
| Repoint-before-fetch (A's refs retained under B's origin) | Not in `FETCH_HEAD` → unverified → cache/API |
| Local-only branch (never fetched) | Ambient tip unreachable from proven tips → unverified → cache/API (404 upstream) |
| Never fetched / failed fetch (empty `FETCH_HEAD`) | Checkout unproven → cache/API |
| Retarget during read (origin or binding changed) | URL halves no longer match → unproven next read; object ids are immutable so a completed read is still accurate |
| Omitted ref | `baseBranch`'s proven tip → else the for-merge sha → else unverified → next source |
| No `workspacesDir` configured | localPath proof still applies; fallback is the GitHub API |

## Boundaries

The proof guards honest-but-stale state (the reported bug class), not a malicious owner: someone who can hand-edit `FETCH_HEAD` can already point `localPath` anywhere, and content-addressed objects cannot misattribute their content. Reads stay network-free on the localPath leg — fetch evidence is read, never produced. No task creation, no thread borrowing, no upload requests. Hosted and `repoKind: 'local'` reads are unchanged, the workspace cache keeps its root-confinement and `refs/cairn` verification, and the GitHub API fallback keeps its token, ref-resolution and size handling.
