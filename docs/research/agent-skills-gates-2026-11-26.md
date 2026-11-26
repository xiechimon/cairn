# Where addyosmani/agent-skills is stricter than Cairn

Record, 2026-11-26. The owner approved adopting the stricter points (`全部照做`). This file holds the prior art, the gap per item, and the slice plan as written before any slice was built.

Marks: **M** measured (read or run for this file), **I** inferred from measured facts, **G** guess.

Cairn was read at `dcacc43af`.

## Sources

| Source | How it does it | Trade-off for Cairn | Link |
|---|---|---|---|
| addyosmani/agent-skills, floor guard (M) | Diff-scoped from the merge base. Red on five moves: weakened threshold, easier test, new suppression, stub or empty catch, new exception row. Exit 0 clean, 1 violation, 2 could not run; "Never let a `2` read as a `0`". Prints rule and location, never the matched text. | Regex-shallow by design. The contract fits; the code does not (it keys on a `CONSTRAINTS.md` Cairn has no use for). | [floor-guard.md](https://github.com/addyosmani/agent-skills/blob/e997ac5b9a74eab332d5e9793bb38a38c8cfdd74/skills/constraint-driven-development/references/floor-guard.md) |
| same, constraint-driven-development (M) | Exceptions table with owner and expiry (90 days by default). `gitleaks --redact` is mandatory. Each gate is tested against a known violation, a clean control and a scanner error. | Adopt the register and the three-case test. | [SKILL.md](https://github.com/addyosmani/agent-skills/blob/e997ac5b9a74eab332d5e9793bb38a38c8cfdd74/skills/constraint-driven-development/SKILL.md) |
| same, git workflow and code review (M) | About 100 lines good, 300 acceptable for one logical change, 1000 must split. A different model gives a different review perspective. | Cairn history exceeds 300 lines often, so a block would stop work. | [git-workflow](https://github.com/addyosmani/agent-skills/tree/e997ac5b9a74eab332d5e9793bb38a38c8cfdd74/skills/git-workflow-and-versioning) |
| same, shipping, security, deprecation, observability, doubt (M) | Rollback plan per launch; flags carry owner and expiry; staged rollout. A leaked secret is rotated first, then purged. Expand/contract, a tested down path, zero verified usage before removal. A correlation id everywhere, and one induced failure located from telemetry alone. One fresh context sees artifact and contract, never the claim; at most three cycles. | Written for a hosted service. Cairn ships a desktop app with a local SQLite file, so "a later deploy" means "a later release that an old app may skip". | [skills/](https://github.com/addyosmani/agent-skills/tree/e997ac5b9a74eab332d5e9793bb38a38c8cfdd74/skills) |
| cursor/plugins pstack (M) | `blast-radius`: prove the one fact the change is safe by, by running code. `interrogate`: several models attack a change; only findings proven by a run survive. | `review-head` already has the load-bearing fact. The "proven by a run" filter belongs in the doubt pass too. | [pstack](https://github.com/cursor/plugins/tree/b7b93c36be9bcc36a74db438e0fd385d660bc559/pstack) |
| mattpocock/skills (M) | `code-review` runs two fresh-context passes (standards, spec). `to-tickets` sequences wide refactors as expand, migrate, contract. `setup-pre-commit` has no secret scan. | Confirms fresh context and expand/contract ordering. | [skills](https://github.com/mattpocock/skills/tree/6f7f7831a625f040a8e06a0e7954826b87ce775a/skills) |
| Claude Code skills docs (M) | A skill can set `context: fork` and `model`; with fork, `model` is the subagent's model. | A different-model review needs no new tooling. | [skills](https://code.claude.com/docs/en/skills) |
| Mergify docs, batches (M) | Batches trade CI runs for a wider blast radius on failure. No change-size or weakened-test control on that page. | Cairn already batches speculatively; nothing to take. | [batches](https://docs.mergify.com/merge-queue/batches) |
| GitHub docs, rulesets and releases (M) | Required status checks gate the branch. "Latest release" is the newest non-draft, non-prerelease release. | The desktop updater reads `releases/latest/download/desktop-latest.json` (M, `apps/desktop/README.md`), so a prerelease is invisible to installed apps with no client change (I). | [rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets), [releases API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release) |
| GitHub push protection (M) | Blocks a push that holds a supported secret, before it lands. Enabled on this repository; non-provider patterns are disabled (M, repository API). | It already covers provider tokens on the pre-flight push. Generic keys and passwords are the gap. | [push protection](https://docs.github.com/en/code-security/concepts/secret-security/push-protection) |
| gitleaks v8.30.1 (M, README) | `gitleaks git --log-opts=<range> --redact`. Exit 0 clean, 1 leak **or error**, 126 unknown flag. `.gitleaksignore` by fingerprint. | Every non-zero is red, so it fails closed. Not installed on the authoring host; no replay yet. | [README](https://github.com/gitleaks/gitleaks/blob/v8.30.1/README.md) |
| OWASP secrets management (M) | Incident remediation lists revocation first. | Matches rotate-then-purge. | [cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) |
| Langfuse docs, trace ids (M) | A seed gives a deterministic trace id. | Cairn already derives trace ids from step and build ids. Nothing new to generate. | [trace ids](https://langfuse.com/docs/observability/features/trace-ids-and-distributed-tracing) |
| Langfuse source at the deployed version | Blocked: not read. No planned change depends on Langfuse server behavior. | Read it if a slice starts querying across traces. | [repo](https://github.com/langfuse/langfuse) |
| OpenTelemetry GenAI conventions (M) | `gen_ai.conversation.id` should be set when the application has one. | Thread and todo ids are the session ids today. | [agent spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md) |

Earlier records still apply: `docs/research/test-integrity-gates-2026-11-26.md`, `docs/research/agent-regression-prevention-2026-11-26.md`, `docs/research/5396-desktop-update-rollback-prior-art.md`.

## What fits

Take the contracts (diff-scoped, exit 2 is never 0, redacted output, register with owner and expiry, three-case gate tests). Do not take `CONSTRAINTS.md`: Cairn keeps rules in gates and `AGENTS.md`, and a second rule file would be a second path.

## Facts that shape the plan

### Pre-flight skips cheap CI checks (item 10)

- M: `fastGatePlan` runs `pnpm lint`, the CI-scheduling tests (only for those paths), per-package typecheck and `pnpm test:changed`. It runs none of the node gates in `prepushPlan`'s `required` list.
- M: no script or workflow validates the `<scope>(<ticket>): <subject>` format. What CI does read from commit messages: `test-integrity-gate` (reason trailers), `regression-inversion-gate` (a `fix` subject needs a test), `product-surface-gate` (`Prompt-growth:` trailer), `english-only-gate` and `public-content-gate`.
- M, one lane on 2026-11-26 lost four pre-flight rounds this way: [run 45766883055](https://github.com/xiechimon/cairn/actions/runs/45766883055) product surface, [45772587039](https://github.com/xiechimon/cairn/actions/runs/45772587039) UI registry, [45832564009](https://github.com/xiechimon/cairn/actions/runs/45832564009) regression inversion on `9ca7fcdb8`, [45834080465](https://github.com/xiechimon/cairn/actions/runs/45834080465) test integrity on `e85c16eb2`.
- M, red on the parent: `test-integrity-gate.mjs --commit e85c16eb2` exits 1, and `fastGatePlan` for a web change returns only lint, web typecheck and `test:changed`. `evaluateFixCommit` on `9ca7fcdb8` returns not-ok before running any test (it changed one e2e spec, which the gate does not count).
- M, fail-open: without `TEST_INTEGRITY_BASE_SHA` or `PREPUSH_BASE_SHA`, the same gate prints `PASS: no merge-base for this checkout` and exits 0. Adding the command alone would guard nothing.
- I: `public-content` and `english-only` run only after the pre-flight push, which already publishes the commit to this public repository.
- M, CI seconds in a green `check-core` (run 45843034238): conflict markers 0.09, UI registry 0.10, UI consumer shape 0.38, english-only 0.59, public content 0.26, doc refs 0.56, retired terms 0.45, journal newline 0.03, UI debt 0.48, flake ledger 0.04, test integrity 0.08, regression ledger 0.04, product surface 0.73, UI drift 0.39, page style 0.14, tmp ratchet 0.16, packaged journey 0.04, visual baseline 0.11. Sum about 4.7 s. Over 1 s and left out: import cycle 2.03, dead runtime exports 1.02. For scale, lint 8.6 and typecheck 28.7.
- M, authoring laptop, sequential, clean tree, no base variable (so some gates saw an empty range): 89 s cold at load 14 to 44; 23 s warm at load 8 to 34, of which product surface 9.0 and every other gate under 2.2. Feature map 0.42 and migration-main 0.23 pass; canon `--check` needs installed dependencies, which this worktree lacks. I: run in parallel, the warm wall time is near the slowest gate.

### Weakened bar (item 2)

- M, tracked source today: 143 empty `catch` blocks (17 in tests), 203 `.catch(() => {})`-shaped swallows, 25 `biome-ignore` lines, 9 `eslint-disable`, 1 `@ts-expect-error`, 1 `@ts-ignore`, 22 `skipIf`/`runIf`. These counts are regex matches.
- M, replay over 300 non-merge commits (2026-11-24 to 2026-11-26), commits with a net increase: suppressions 0; `.skip` family 1 (a string inside a gate's own test, a false positive); `skipIf` 3 (platform conditions); empty catch 26; promise swallow 23 (overlap with empty catch not computed); lines setting a timeout or retry number 11 (additions counted, loosening not checked).
- M: `test-integrity-gate` covers deleted tests and lost assertions. I: nothing covers new suppressions, new empty catches or loosened thresholds.

### Change size (item 1)

M, same 300 commits, lockfile, snapshot, migration metadata and images excluded: 149 exceed 300 changed lines or 5 files (122 by lines, 137 by files). Without tests, docs and translations: 108 (75 by lines, 95 by files). I: a warning fires on a third to a half of landings, so it must stay a warning.

### Secrets (item 4)

M: no secret scan runs in pre-flight or CI. `public-content-gate` scans for other disclosures. Push protection is enabled for provider patterns.

### Rollback (item 3)

- M: the desktop app already rolls back automatically when a new version fails to start, and blocks that version (`docs/design/desktop-update-rollback.md`, `apps/desktop/src/update-core.ts`).
- M: the release body written by `desktop-release.yml` names no previous version and no way back.
- I: replacing the app by hand does not stick, because only the automatic rollback blocks a version and the updater checks hourly. The release notes must say so, not promise otherwise.
- I: migrations only go forward, so an older app meets a newer schema. After a destructive migration it may not run. 0.1.536 failed on `DROP TABLE im_connection`.
- I: no product feature flag exists today (the old table was removed in `0134_drop_feature_releases.sql`).

### Migrations (item 6)

M: no down migration file exists. From 2026-11-12 to this record 110 migration files were added; 26 of those still present match `DROP TABLE`, `DROP COLUMN` or `RENAME`, which includes SQLite table rebuilds. G: the installed Drizzle migrator has no down runner (not re-read here).

### Correlation (item 7)

- M: a Coordinator turn's trace id comes from its step id, a task's from its build id. Step spans carry `cairn.step_id`; task spans carry `cairn.todo_id`. A task's session is the todo id, a turn's is the thread id.
- M: `emitRuntimeBuildSpan` sets nothing that names the thread or message that created the task. A Coordinator-made todo stores `sourceRef` `chief:<thread>`, and its request segments can hold a chat `threadId` and `messageId`.
- I: going from a failed task back to the turn that created it needs the database. Not checked: whether a turn's tool-result span already carries the new todo id; check that first in the slice.
- M, line-based grep, so an undercount for multi-line calls: 4 of 75 server and daemon log lines name a step id.

### Brief gate (item 8)

- M: the brief lint is the owner's dispatch script, outside the repository. `design-cairn`'s UI brief template has no stays-unchanged field.
- M, red on today's lint: 49 UI briefs on disk, 2 pass, neither holds a stays-unchanged list.
- M: no dispatch script calls the lint. I: it runs only when the dispatcher remembers to (all 23 non-read-only UI briefs newer than the lint's last edit fail it).

## Recommended design: staged desktop rollout (owner decides)

| Option | What a new user meets | Cost | Catches |
|---|---|---|---|
| A. Keep today | The newest release within an hour; automatic rollback if it cannot start | 0 | Start failures only |
| B. Prerelease soak: publish as prerelease, one owner-run Mac follows it, promote to latest after it ran healthy for a set time | The same app, a few hours later. No new setting for users | A promote step, a follow flag only the owner sets, a stuck-prerelease alarm. `release-plan.mjs` counts only stable releases as the baseline and must change | Start failures and what the owner notices while using it |
| C. Percentage rollout (Sparkle style) | Some users later than others | Client change, cohort id | Nothing without failure telemetry, which Cairn does not collect |

Recommendation: A now, B when the app has users other than the owner. The last 12 releases were 29 to 95 minutes apart (M), so B needs a rule for which prerelease gets promoted before it is worth building.

## Plan

One row per item, in landing order: checks that add no CI time first, by value; the one that adds CI time after the cheap fail-fast work it depends on. Each slice is at most about 300 lines and 5 files. "Red seen" means run for this record on the real past case; everything else must be seen red while building, before the fix.

| Order, item | What changes | Files | Red test | CI time | Fails safe | Newcomer |
|---|---|---|---|---|---|---|
| 1a, item 10 | The fast gate first runs every CI check at or under about 1 s, in parallel, before lint. One list exported from `prepush.mjs`. The merge base is passed to each as an argument or env prefix, so a wrapper keeps it. A coverage test forces every node gate in CI into the list or into a named slower/CI-only list with a reason. `test-integrity` with no base exits 2 | `scripts/prepush.mjs`, `scripts/ops/preflight-fast-gate.mjs` and its test, `scripts/test-integrity-gate.mjs`, `AGENTS.md` pre-flight step | Red seen: `e85c16eb2` fails the gate while the plan omits it; the no-base run exits 0 | 0 s (the coverage test joins an existing self-test file). Pre-flight: about 5 s of CI-class compute; laptop figures above; measure parallel wall time in the slice | Missing base or crashed gate is red | none |
| 1b, item 10 | Static mode for regression inversion (a fix commit with no counted test), added to the fast list | `scripts/regression-inversion-gate.mjs` and its test, `scripts/ops/preflight-fast-gate.mjs` and its test | Red seen: `9ca7fcdb8` is not-ok before any test runs, and pre-flight does not ask | 0 s | Missing base is red | none |
| 2, item 4 | `scripts/ops/secret-scan.mjs`: `gitleaks git --redact` over merge-base..HEAD, before the push. `AGENTS.md`: rotate first, then purge | new script and test, `preflight-fast-gate.mjs`, `AGENTS.md` | A key generated at run time in a temp repo (never committed as a literal); clean control; missing binary. Not seen. Replay over 300 commits before enabling; false positives go to `.gitleaksignore` | 0 s. Pre-flight seconds unmeasured | Missing binary or any non-zero exit is red, with the install command | none |
| 3, item 8 | UI briefs need a `Stays unchanged:` block with one line per state (placement, interaction, controls). Add the field to the template. The dispatch script runs the lint and refuses to start on failure | outside the repo: the lint and the dispatch script. In repo: `.claude/skills/design-cairn/SKILL.md` | Red seen: two real briefs pass today. Control: the same brief with an empty block or `none` stays refused | 0 s | Lint missing or erroring refuses dispatch | none |
| 4, item 3a | Release notes name the previous stable version, link it, and say how to go back, that the app will update again, and when an older version may not open newer data. Flags: one `AGENTS.md` line, owner and expiry in the product-surface row | `scripts/ops/release-notes.mjs` and test, `desktop-release.yml`, `AGENTS.md` | The real current body has no previous version. Not yet written | Under 1 s in the existing `gates-workflows` step (G) | No previous stable release found, or lookup error: publish fails and the draft stays | Meets it on the GitHub release page. Needs no account. Downloads the named dmg. Stuck point: the app updates again; a newer schema may not open |
| 5, item 2a | `scripts/weakened-bar-gate.mjs`: suppressions, `.skip/.todo/.only/.fixme`, empty `catch` and `.catch(() => {})`. Committed per-file baseline that may only shrink against the merge base; register `scripts/bar-exceptions.json` (rule, path, reason, owner, expires). Output is rule and location only | gate, test, baseline, register, `prepush.mjs` | A real added empty catch from `ec20fced4`; clean control; no-base exits 2; an entry with an empty reason or owner is red | Under 1 s in `check-core` (I from sibling gates, 0.04 to 0.73 s). `check-core` ended 2 min before the last e2e shard in the sampled run, so wall time does not move (I). Also in item 10's list | Exit 2 on no base or unreadable baseline. Expired entry is red only for diffs touching that path, so a date never reds unrelated lanes | none |
| 6, item 2b | Same gate: loosened numbers in a named list of files and keys (test timeouts and retries, job `timeout-minutes`, gate limits, Biome rule severity) | gate, test | A real past loosening, to be picked from the 11 candidate commits. If none is a loosening, say so and use a synthetic case | Inside row 5 | Unparseable watched file exits 2 | none |
| 7, item 6 | Design-first rule: expand/contract order, a down migration that was run against a copy with data, zero-usage evidence before removing persisted data or wire fields | `AGENTS.md` | Prose; no honest red test. Past case: 0.1.536 | 0 s | not applicable | none |
| 8, item 9 | `AGENTS.md`: the implementing change writes the owner's product decision into the design doc, his words verbatim inside backticks (the English-only gate ignores code spans, M) with an English gloss; nothing personal | `AGENTS.md` (same slice as row 7) | Prose | 0 s | not applicable | none |
| 9, item 1 | Pre-flight prints changed lines and files for the lane and warns over 300 or 5. Ratchet: the committed limits may only go down | `scripts/ops/change-size.mjs` and test, `preflight-fast-gate.mjs` | A real oversized commit warns, a small one does not, no base is red. Not seen | 0 s | Never blocks on size; failing to measure is red | none |
| 10, item 5 | Skill edits: `review-head` may run on a different model for high-risk heads (auth, secrets, migrations, updater, landing path, computed-path deletion). `workflow`: before a design or non-trivial fix becomes a commit, one fresh context gets artifact and contract only, one round, and a finding counts only with evidence | outside the repo: two skill files | Prose; no red test | 0 s | The report names the model used, or says the pass was skipped | none |
| 11, item 7 | Task root span adds the origin thread and message ids from the stored request (no migration). `verify-cairn`: induce one failure and locate it from logs or Langfuse alone | `apps/server/src/runtime-otel.ts` and its test, genai attribute constants, `verify-cairn` skill | Span lacks the origin ids on the parent | Under 1 s in an existing server test file (G) | No chat source: attributes absent, never invented | none |
| later, item 3b | Staged rollout, only if the owner picks B or C | design first | | | | see options |

### Gate rules for rows 1a, 1b, 2, 3, 5 and 6

- Ratchet: row 5 has a shrinking baseline. Rows 1a to 3 have no existing violations to carry; 1a and 1b reuse gates CI already enforces.
- Replay: rows 1a and 1b add no new verdict. Rows 2, 5 and 6 replay recent `main` commits before enabling. For row 5, suppressions would have blocked nothing in 300 commits, while empty catch and swallow would have required a fix or a register entry in up to 26 and 23. Those are real hits of the new rule, not detection errors; the detector must still parse blocks, not match text, to avoid the string false positive seen for `.skip`.
- No hollow satisfiers: each gate test has a violation, a clean control, a could-not-run case and, where an artifact satisfies it, an empty one.

## Decisions after the plan (2026-11-27, orchestrator)

- No separate commit-title gate. No title-format check exists in CI or in the repository scripts (M), so row 1a has none to move; it runs the gates that read commit messages.
- Rows 3 and 10 may edit files outside the repository; each diff goes in the lane report.
- Row 5 blocks both empty-catch forms, detected on the syntax tree, with the shrinking baseline.
- Row 9 commits the 300-line and 5-file limits; they only go down, and the check only warns.
- Waiting on the owner: the different-model half of row 10, and row 3b. The rest of row 10 is released.
- Row 1a lands in two slices (2026-11-27): first the test-integrity gate stops passing without a base; then the pre-flight checks, with the check list and each run condition read from the CI workflow so that it cannot drift, and a step that cannot be classified failing the coverage test.
