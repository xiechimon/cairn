# One full review per change — plan, 2026-11-28

## User scenario

A contributor with a Cairn worktree runs the existing plan review before coding. Today a finding forces them to replace the verdict with a fresh review, which can uncover another round of small issues. The approved change (「照这个改」) lets them fix the original findings and proceed with a narrow check from the same reviewer model. It adds no accounts, credentials, or paid steps.

## Scope

1. Keep one independent full plan review. `PASS` needs only a current `Plan-SHA256`; `CONCERNS` means only should-fix findings; `BLOCK` means a real exploit, data loss, or the wrong requirement. Continue to read legacy `FAIL` as `BLOCK` without rewriting landed records.
2. After `CONCERNS` or `BLOCK`, fix the listed findings together. Keep the original verdict, findings, and `Plan-SHA256` (the full review's body hash). Run `pi-review.sh check plan <file>` with the original reviewer model and record `Fix-check: PASS` and `Fix-check-Plan-SHA256` for the checked body. After any later edit, use confirmation only and let the wrapper enforce its two-attempt cap; never start a second full review. Hashes show which versions were recorded; they do not authenticate the reviewer, verify that the wrapper ran, or assess finding severity or coverage. The reviewer applies those rules.
3. Use one final `## Review` with one verdict and at most one of each recognized metadata field. Reject duplicate required body headings and any level-two section after Review so required content cannot be replaced outside the hashed body. Ignore fenced examples and inline prose. Keep case-insensitive values and CRLF compatibility, requiring a bare status token. The shared validator checks the working file, each commit's own plan, and the final plan at range HEAD; a later valid fix-check does not retroactively bless an invalid commit.
4. Replace PASS-only instructions in `AGENTS.md`, `docs/agent-dispatch-prompts.md`, and the `docs/ops/plan-gate.md` workflow and template. Document confirmation-only refresh, including both fix-check fields, and register obsolete wording in `scripts/doc-retired-terms.json`. Historical records, independent review, proving tests and landing checks stay in place. The original planning precedent is recorded in [the plan-gate research](../research/plan-gate-2026-11-27.md).

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Should-fix findings fixed by the reviewer model | CONCERNS with a matching fix-check passes without a second review | scripts/plan-gate.test.mjs | this change |
| Blocking or legacy FAIL findings | Current passing fix-check accepts either; missing status or hash, failed status, and stale hash are refused. Existing legacy records are not rewritten | scripts/plan-gate.test.mjs | this change |
| Body changed by a fix | Original reviewed hash remains; only confirmation for the edited body passes (current hash positive control vs stale fix-check) | scripts/plan-gate.test.mjs | this change |
| Duplicate verdict, metadata, or required heading | The second record is refused instead of silently choosing one; a section after Review also fails instead of allowing unhashed edits | scripts/plan-gate.test.mjs | this change |
| Text that looks like review metadata | Backtick and tilde fenced examples, including an unclosed example containing the only verdict, cannot supply metadata. Leading BOM, CRLF, and case variants are accepted; trailing status text is not | scripts/plan-gate.test.mjs | this change |
| File, commit, and range checks | File/commit accept a current CONCERNS fix-check; a valid later confirmation still passes the range; a later second verdict fails the range | scripts/plan-gate.test.mjs | this change |
| Previously signed PASS plan or unknown verdict | Compatibility/negative controls (not red-first proof): existing valid PASS stays valid; unknown or blank verdict fails | scripts/plan-gate.test.mjs | this change |
| Old instructions copied back into living docs | The retirement canary rejects the old requirement for another review | scripts/doc-retired-terms-gate.test.mjs | this change |

## Out of scope

- Changing product runtime, commit classification, preflight or queue scheduling, the owner-local wrapper, or making the review record a signed attestation. `scripts/plan-gate.mjs` and `scripts/regression-inversion-gate.mjs` share the validator. After queue landing, invoke the gate from main on the CONCERNS fix-check and a duplicate-verdict control, and save both commands and exit statuses.

## Review

- Verdict: CONCERNS
- Plan-SHA256: bfd1ef59aac4b458bb4dcf01d75fa50dbedc75670365aa664135377a70d67f94
- Fix-check: PASS
- Fix-check-Plan-SHA256: 3606744c2b894d282f8de811f4a31a571bd31245e4562df1bae8c568b74207ca
- Author-Model: openai-codex/gpt-6.2-sol
- Reviewer: Pi fresh-context plan review
- Reviewer-Model: anthropic/claude-sonnet-5-5
- Findings: 1 original hash and trust; 2 duplicate metadata and headings; 3 unhashed suffix; 4 red tests and controls; 5 entry-point coverage; 6 living docs and canary; 7 severity and coverage limits; 8 input and wrapper boundaries. Notes 9–11 concern precedent, trust, callers, and the review record.
