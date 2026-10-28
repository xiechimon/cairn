# Issue #2101 recovery

## Commit preparation

The dispatcher must execute the identity-safe recovery recipe in [the operational guidance](../../ops/agent-bot-identity.md#incident-recovery-commit-preparation), outside both identity wrappers. The executable regression reads that durable section directly, rather than a copy in this evidence directory. Keep the reviewed message and co-author trailers, authenticate pushes separately, and use the verified identity-aware rebase route for bot-opened PRs.

## Incident and acceptance boundary

Main commit `241d3f39437333f872fbcbc6250cf12d71e4dbf7` has the forbidden bot author. The reported run `40727979064`, job `122956291279`, correctly rejected it. Preserve that commit and main history. Rerunning its original check cannot change its metadata.

The executable regression runs the actual workflow shell in a temporary repository. It verifies that the preparation recipe overrides inherited bot author and committer variables, preserves the message's co-author trailer, and leaves the historical commit byte-for-byte intact. A subsequent push range and tip fallback accept the compliant correction; checking the historical commit again still fails. The author predicate and workflow are unchanged.

Local acceptance is distinct from main recovery. After a separately authorized merge, inspect the actual main commit's author and the subsequent `commit-author` Actions result. This worktree neither changes nor verifies the external dispatcher's implementation. No push or merge is authorized here, so a green main run is not claimed.

## Overlap

Open #2099 (`lane/2093`) owns the operational identity recipe and inherited-identity tests. Open #2090 (`lane/2088`) owns merge routing and the existing lessons entry. This correction appends an incident recovery section without replacing either branch's existing guidance. Recently merged #2033's range validation and tests are unchanged; no recently merged additions are removed.

## Verification

Run `node --test scripts/commit-author.test.mjs scripts/commit-author-policy.test.mjs scripts/commit-author-recovery.test.mjs`.

The configuration-only preparation recipe failed on actual bot author and committer metadata before the explicit environment assignments were applied. See [negative control](red.txt) and [passing regression](green.txt).

The review corrections explicitly configure and assert the fixture's local Git name and email, disable global/system Git configuration, resolve repository inputs from `import.meta.url`, and register the recovery regression in the trusted main push test step. Root and `/tmp` runs pass. The registration assertion failed before the workflow was changed; the local identity assertion failed before fixture configuration; reading the operational recipe failed before that section was added.

Main recovery is pending: the dispatcher must prepare a compliant commit with the operational recipe and verify actual main metadata plus a later green Actions run after an authorized merge. This branch does not claim that local tests satisfy that remote acceptance criterion. No server was started, and no push or merge was performed.

Current verification: 19 author-policy tests passed, including the recovery registration guard; both recovery tests also passed from `/tmp`. `pnpm lint` passed (one existing informational diagnostic), and the recovery script passed an explicit `pnpm exec biome check scripts/commit-author-recovery.test.mjs`. Serialized under `/tmp/cairn-heavy.lock`, typecheck, spec parsing (1387 web tests and 51 integration files), and `node scripts/prepush-vitest.mjs` passed; Vitest selected no related tests. English-only, single-use-helper and comment-discipline gates each reported zero, and the lessons ledger passed.

Review evidence: [fixture and CI failures](review-red.txt), [other-directory failure](review-cwd-red.txt), [missing operational recipe](review-operational-red.txt), [19 passing tests](review-green.txt), and [other-directory pass](review-cwd-green.txt).

The full `node scripts/prepush.mjs` completed all 30 selected checks under the same lock. Its fetch failed with exit 255 and it used the local `origin/main`, which may be stale. No web E2E surface was selected and no server was started. `COMMIT_MSG.txt` contains the handoff message ending in `Closes #2101`; the dispatcher still owns staging and committing under the sandbox instructions.
