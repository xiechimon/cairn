# Thinking-budget review controls for PR #1933

The installed `@anthropic-ai/sdk` version is 0.129.0. Its `ThinkingConfigEnabled` declaration requires `budget_tokens` to be at least 1024 and strictly below `max_tokens`.

Before the fix, the existing wrapper returned HTTP 400 in both new enabled-thinking controls; the disabled-thinking control passed. `red.log` records two failures and one pass. After the fix, `green.log` records 22 passing cases across the original compaction suite and the new request-level controls.

`wire.json` captures the actual serialized request parameters observed by the fetch boundary in the generic-error replay. The 4096-token thinking budget stays enabled. Recovery uses at least 4097 output tokens and reduces input until the simulated provider accepts the summary. This is deterministic provider-response verification, not a live-provider or full-step survival claim.

The merge conflict was the obsolete `docs/lessons.md` table, already migrated on main. `legacy-lesson-additions.txt` preserves this PR's five added rows. The summary-boundary, JSON-boundary and diagnostic-loader entries now use the current per-file ledger format. The record-ID diagnostic and public-GitHub fixture failures are already represented by `docs/lessons/1825-random-candidate-ids-beginning-with-a-hyphen-were-parsed-as.md` and `docs/lessons/1847-completion-fixtures-called-public-github.md`; those existing entries are unchanged.

Issue #1744 remains open because production step survival and Responses-shaped requests remain outside this delivery's verified scope. PR #1935 overlaps the original implementation and retains earlier review blockers.
