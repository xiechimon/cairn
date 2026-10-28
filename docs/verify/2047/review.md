# Delivery review

Author-side standalone code review against main `13e751c1b72b7012e6d4a940bc1cbe6a279b9d3c`. This is not an independent model verdict. Source hashes are in `source-files.json`.

What it does:
- Delivers the already-contained branch push handling from #2047 with a fresh remote observation, requested-branch identity checks and preserved native pre-push hook input.

Good:
- The proof fetch has an explicit unique destination and an empty refmap. It does not read or overwrite a shared tracking ref or FETCH_HEAD, and its temporary ref is removed on success or failure.
- The fetch address is captured before the push and passed through child-only Git configuration. The fallback is refused when the configured push destination differs or has multiple URLs. URL values do not become command-line arguments.
- The native push still names the local branch, so branch-gated pre-push checks retain their input and rejection error type. Authentication and tag pushes retain their existing behavior.
- The requested branch is read before the push and rechecked before and after the containment proof. An observed ref change rejects the fallback. The operation does not lock the worktree against arbitrary external mutation or guarantee that a remote stays unchanged after the fetch.

Bad:
- The original implementation used a possibly stale tracking ref and current HEAD as proof of delivery. Eight real-Git regressions expose incorrect successes or the wrong reported remote tip. The corrected implementation passes them.
- An initial repair pushed an object ID directly, changing pre-push hook input and bypassing branch-gated checks. A new real rejecting-hook test failed on that repair before restoring the named-ref push. The failing output is preserved in `oid-hook-red.log` and the lesson records the regression.

Ugly:
- No confirmed remaining blocker was found in the changed protocol, URL/credential argument handling, hook rejection ordering or temporary-ref cleanup. The original PR stays open until this replacement lands.
- The command-line Git bridge remains the existing interface. No package, persistence schema, production gate or protected authentication module changes.

Tests:
- Main with the initial new suite: 4 failed, 90 passed. This includes the existing retry behavior before the original PR's source patch.
- Original PR source with the seven new controls: 7 failed, 87 passed. Adding the origin-repointing control yields 8 failed, 87 passed.
- Final same-file suite, including the additional named-branch hook control: 96 passed.
- The four-file Git, workspace and loopback-proxy set passes 109 tests.
- Lint, workspace typecheck and specification collection pass.
- These are real local Git repositories with synthetic identities and local HTTP credential controls. They do not establish hosted-provider delivery or a deployed daemon result.

The simplification pass keeps the original Git retry and hook classification interfaces. A closure reads the requested branch consistently at three points. The temporary remote exists only in the fetch child's configuration, and the temporary ref is scoped to one call. There is no new global cache, hook wrapper, persistent remote or dependency.

After merging main `c6b533e543da50914f408f2232791d41ab3e6d5a`, the four-file suite passes 109 tests again and lint, workspace typecheck and spec collection pass. The fixture setup uses its existing top-level `writeFileSync` import directly instead of importing the same function inline. The earlier 96-test same-file log precedes this import cleanup; `current-main-related-green.log` verifies the current hashed files.

A subsequent runtime review of draft `f379788e` found that assigning an already-expanded URL to a temporary remote applies `insteadOf` rules twice. The real-source observation and the new regression both report a false success against a decoy repository. The repair captures the single raw configured URL and preserves one expansion, compares resolved fetch and push addresses without trimming, and rejects observed address changes. Ordinary aliases remain accepted, and ambiguous multiple-fetch mappings are rejected. The current four-file run passes 112 tests. The stale f379 verdict remains blocked in the PR history.

The standalone runtime observer is under `integration/eval/git-push-proof/` so the mandatory integration compiler checks it. Its before/after JSON records FETCH_HEAD, tracking refs, persistent config and remaining proof refs. Runtime source hashes distinguish the actual files from the checkout HEAD when an observation runs with uncommitted changes.

Main advanced to `928fd93c9ceb896bf83e536166224ef3414a08ec` with routing-evaluation files while the independent review of snapshot `4155ffa1` queued. The five-file implementation, tests and observer diff is byte-identical after merging that main, as recorded in `latest-main-equivalence.json`. The supporting Git, workspace, proxy and shared GitOps files on main are also unchanged. Lint, workspace typecheck and spec collection pass on the merged tree; integration collection now covers 50 files.

CI run `40640258633` passed all four browser shards but failed the positive workspace containment test. The fixture attempted its merge without an explicit commit identity and ignored Git exit codes. With global and system configuration disabled and `user.useConfigOnly=true`, the unmodified fixture reproduces the same missing-log failure. Passing the existing synthetic identity into the merge, requiring successful merge and push exits, and asserting both merge parents makes the same six-test run pass. Product source is unchanged. This test-only follow-up is outside independent snapshot `4155ffa1`; that snapshot and the earlier five-file equivalence artifact describe the preceding revision.

The follow-up author review checks the test-only diff against `cfcc1228`: the merge still uses the same branches and message, the identity matches the other fixture commits, and the assertions require the intended local and main parents. No confirmed finding remains in this follow-up. The four-file Git, workspace, credential-fallback and loopback-proxy run passes 134 tests; lint, typecheck and spec collection pass in `fixture-final-checks.log`.
