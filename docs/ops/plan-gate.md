# Plan Gate

Scale planning to risk so missing edge cases and contradictions are caught before code rather than in code review.

## Risk Tiers

| Tier | Applies to | Required artifact | Machine check |
|---|---|---|---|
| **Tier 0** | Small single-path `fix`, `docs`, `test`, `ops`, `ci`, `chore`, `security`, or behavior-preserving `refactor` touching neither persisted state nor wire/step protocols | No plan file | `scripts/plan-gate.mjs` skips |
| **Tier 1** | `feat`, user-visible behavior change, new mechanism, persisted-state change (`apps/server/drizzle/`, `apps/server/src/db/schema.ts`), wire/step protocol change (`packages/shared/src/protocol/`), or concurrency change | Plan at `docs/design/<slug>.md` with `Slice/Status` on every edge row, real proving tests that pass on the commit and fail on the parent source, and one independent review (`Reviewer-Model` != `Author-Model`) with a current hash as described below | `scripts/plan-gate.mjs` (fast gate and CI `check-core`) + `scripts/regression-inversion-gate.mjs` (CI light and integration) refuse missing proving test files, any unmodified `"this change"` runnable test, tests failing on the commit or passing on the parent, and same-model reviews |

## Workflow

1. **Draft the plan** at `docs/design/<slug>.md` using the template below before writing implementation code. For persisted-state, protocol, or concurrency changes, `## Edge cases` must cover states, transitions, every reader and writer, and each failure path. Every `## Edge cases` row must name a repo-relative `Proving test` file path and set `Slice/Status` to `this change` or `later: <ticket or slice>`.
2. **Fresh-context analyze** (Clarify + Analyze): hand the plan file (with read-only codebase access, no implementation context) to an independent model different from the author's (`Reviewer-Model` != `Author-Model`) for one full review of missing edges, untestable rows, and contradictions. Record the original verdict, findings and body hash from `node scripts/plan-gate.mjs --hash docs/design/<slug>.md` in the final `## Review`. `PASS` needs that original `Plan-SHA256` to match the current body. `CONCERNS` means should-fix findings; `BLOCK` is reserved for a real exploit, data loss, or the wrong requirement. Read legacy `FAIL` as `BLOCK` without rewriting landed records.
3. **Resolve findings and verify**: for `CONCERNS`, `BLOCK`, or legacy `FAIL`, fix the numbered findings together, preserving the original verdict, findings and `Plan-SHA256`. Run `pi-review.sh check plan <file>` with the original reviewer model (`REVIEW_MODEL`); it checks only those numbered findings and raises nothing new. Record `Fix-check: PASS` and `Fix-check-Plan-SHA256` for the current body. After any later body edit, use confirmation only, update the fix-check fields for the current body, and let the wrapper enforce its two-attempt cap. Never start another full review, including after a later hash change. For an originally passing review whose body later changes, use confirmation only and refresh `Plan-SHA256` to the current body after confirmation. Check the file with `node scripts/plan-gate.mjs --check-file docs/design/<slug>.md`.
4. **Implement**: reference `Plan: docs/design/<slug>.md` in the commit trailer of every Tier 1 commit. At least one `Edge cases` row must be marked `this change`, every file named in `this change` rows must exist at the commit, and every `"this change"` runnable proving test file must be added or modified in that commit, pass on the commit itself, and fail when run against the parent product source (`scripts/regression-inversion-gate.mjs`).
5. **Row-by-row code review**: code review checks the diff row by row against `## Scope` and `## Edge cases`, confirming every scope row is met, every edge row is proven by its named test (or tracked under `later: <ticket or slice>`), and unrequested behavior is absent.

Use the original plain ATX heading dialect: required headings start at column 1 with `## `, and the final heading is exactly `## Review` (case-insensitive, no closing hashes). Setext headings and indented ATX headings are ordinary text to this scanner. Use one verdict and at most one of each recognized metadata field; do not duplicate required body headings. Any declared `Fix-check` must be `PASS` with a current `Fix-check-Plan-SHA256`, even for a `PASS` verdict; outright `PASS` needs no fix-check. For a non-PASS review, the original `Plan-SHA256` is checked for well-formedness only: the gate cannot independently verify the historical body it describes. Refreshing a prior PASS hash after later body edits is an honor-system confirmation, not proof confirmation happened. Hashes do not authenticate the reviewer, prove the wrapper ran, or judge finding severity or coverage. Those are human/model judgments.

## Plan Template (`docs/design/<slug>.md`)

```markdown
# <Feature title> — plan, YYYY-MM-DD

## User scenario

Newcomer first: where a first-time user meets this change, what they already need to know, what accounts/keys/storage it uses, and what they see when it fails.

## Scope

1. <Concrete behavior row 1>
2. <Concrete behavior row 2; state explicitly what stays unchanged>

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| <Empty / missing / invalid input> | <Exact UI, API, or CLI outcome> | `apps/server/test/<feature>.test.ts` | this change |
| <Offline / restart / repeated press / concurrent writers / old+new version> | <Exact recovery or failure behavior> | `apps/web/e2e/<feature>.spec.ts` | later: <ticket or slice> |

## Out of scope

- <Explicitly excluded item or follow-up>

## Review

- Verdict: PASS
- Plan-SHA256: <output of node scripts/plan-gate.mjs --hash docs/design/<slug>.md>
- Author-Model: <author model id, e.g. claude-opus-4-6>
- Reviewer: <fresh-context reviewer name/session>
- Reviewer-Model: <independent model id different from Author-Model, e.g. openai-codex/gpt-6.2-sol>
- Findings: <0 blocking; edges and contradictions checked>
```

For a non-PASS review, replace the template verdict with the original `CONCERNS` or `BLOCK`, retain its original findings and hash, and add these fields once in the same final `## Review` after confirmation (refresh them after a later changed body):

```markdown
- Fix-check: PASS
- Fix-check-Plan-SHA256: <output of node scripts/plan-gate.mjs --hash docs/design/<slug>.md for the checked body>
```

## Anti-Rationalization Table

| Excuse | Reality |
|---|---|
| "This is too simple — no plan needed" | Simple features still hide empty, offline, reload, and repeated-press edges. Keep the plan to one page, never zero pages. |
| "I tested it manually" | Manual clicks vanish on the next commit and miss concurrent or failure paths. Every edge row names the automated test that proves it. |
| "I will add edge cases or tests later" | Unplanned edges surface in code review and multiply pre-flight loops. Either write the proving test in `this change` (red against parent) or mark `Slice/Status` as `later: <ticket or slice>`. |
| "A same-model subagent reviewed it" | Same-model subagents share the author's blind spots. Tier 1 plans require an independent `Reviewer-Model` different from `Author-Model`. |
| "I will write the plan after coding" | That is post-hoc documentation, not planning. Writing the plan first exposes contradictions before code exists. |
| "Requirements are obvious" | Obvious requests carry implicit assumptions. Numbered scope rows, out-of-scope boundaries, and fresh-context analysis surface them early. |
| "Code review will catch any missed edge" | Catching missed edges in review costs 5–22 pre-flight rounds and 44–99 minutes p50/p90. Finding them in a two-minute fresh-context plan pass avoids the loop. |
