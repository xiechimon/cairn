# Thinking-budget review controls for PR #1933

The installed `@anthropic-ai/sdk` version is 0.129.0. Its `ThinkingConfigEnabled` declaration requires `budget_tokens` to be at least 1024 and strictly below `max_tokens`.

Before the fix, the existing wrapper returned HTTP 400 in both new enabled-thinking controls; the disabled-thinking control passed. `red.log` records two failures and one pass. After the fix, `green.log` records 22 passing cases across the original compaction suite and the new request-level controls.

`wire.json` captures the actual serialized request parameters observed by the fetch boundary in the generic-error replay. The 4096-token thinking budget stays enabled. Recovery uses at least 4097 output tokens and reduces input until the simulated provider accepts the summary. This is deterministic provider-response verification, not a live-provider or full-step survival claim.

The merge conflict was the obsolete `docs/lessons.md` table, already migrated on main. `legacy-lesson-additions.txt` preserves this PR's five added rows. The summary-boundary, JSON-boundary and diagnostic-loader entries now use the current per-file ledger format. The record-ID diagnostic and public-GitHub fixture failures are already represented by `docs/lessons/1825-random-candidate-ids-beginning-with-a-hyphen-were-parsed-as.md` and `docs/lessons/1847-completion-fixtures-called-public-github.md`; those existing entries are unchanged.

Issue #1744 remains open because production step survival and Responses-shaped requests remain outside this delivery's verified scope. PR #1935 overlaps the original implementation and retains earlier review blockers.

## Final merge-contract audit

The explicit auto-merge message configured at 21:43 UTC was later replaced. GitHub records auto-merge disabled at 21:48:57 UTC and a new auto-merge request at 21:49:13 UTC with null squash headline and body. The specific process responsible for that second call is unverified. The shared review gate's audit file has no corresponding new review record.

Main commit `93270f3b90ad950c4228302b33d56b49bad26fe8` has the exact reviewed tree, but its default aggregated message carries three historical parent-closing keywords. It closed issue #1744 at 21:53:06 UTC. The issue was reopened at 21:57:23 UTC because its production lifecycle and Responses-shaped acceptance remain incomplete. No history was rewritten.

`rearmed-merge-snapshot.json` is the captured GitHub metadata. `configured-merge-fixture.json` is a positive fixture constructed from the audited committed message. `merge-contract-red.log` records the old verifier incorrectly accepting the captured null-field payload; `merge-contract-green.log` records both controls passing after the verifier checks actual stored auto-merge fields. The verifier accepts either a message file or a `gh pr view --json autoMergeRequest` snapshot. A disabled auto-merge request is safe; an enabled request must retain the exact audited squash message.

This check detects a changed configuration when executed. It cannot prevent another writer from changing configuration after the check. Eliminating that race requires a shared dispatcher constraint or a delivery branch with safe default commit messages; that shared path was not modified under the current ownership restriction.
