---
Category: A server-side gate fed a hardcoded placeholder patch record to the digest, so the judged digest could never match the daemon's real diff digest; the acceptance e2e was committed red and the branch recorded the mismatch as an external blocker instead of as its own bug
Source: #1625 (2026-10-25)
Level: 2
Safeguard: `apps/server/test/local-merge-local-digest.test.ts` builds a real temp repository and asserts the digest computed through `localGateFacts` equals the one the daemon's `inspectLocalPatch` computes, so any fabricated or partially reconstructed compare facts turn the suite red
Intercepts: 1
Recurrences: 1
Notes: Negative control: restoring the `LOCALLY_DIFFED` placeholder reports `pd2:4b90e605…` against the daemon's `pd2:e70a37f7…` and both the parity test and the `g2t2` lifecycle e2e go red. The same kind reappeared as the wrong blocker diagnosis in `docs/verify/1625`, which claimed the server holds no local checkout; `requestMerge` already read `projectRow.localPath` through `git.listBranches`, so the fix needed no machine protocol change. Root level 1 is not reachable: a digest is a value, not a type, so no signature can make a fabricated compare record unwritable.
---
