# Langfuse trace self-review of the user_computer_* fix (2026-11-18)

Task [#5354]: review the fix steps of the previous task through its Langfuse
trace, self-debug, and name what can still be optimized. The fix under review:
`unknown chief tool: user_computer_*`, landed on `main` as `ae5a9a36`
(build `01a1eeb0`, todo `z8`, Devin/SWE-2 lane on the owner's Mac).

## Method and evidence sources

Two sources were used, because neither alone shows the whole picture:

- **Langfuse Cloud** (project on `cloud.langfuse.com`, environment `mac`),
  queried with `GET /api/public/v2/observations` using the ingestion key pair
  from `~/Library/Application Support/@cairn/desktop/otel.env`. Trace ids were
  derived with `otlpTraceIdOfBuild` / `otlpTraceIdOfTurn`
  (`packages/shared/src/otel.ts`). Relevant traces:
  - `959b482b6477f4229870df2c812f2acd` — the fix build under review.
  - `80136feea76319a9c567f7151bb51dba` — the Coordinator turn that dispatched
    this review.
  - `d952f208825eafb3a36bfede401a6322`, `78c8718d95630eacbbd713d007304682`,
    `6995ff2a8038a0c29a95ec9d373b2a9d` — anomalies found while scanning.
- **The lane's local transcript store**,
  `~/.local/share/devin/cli/sessions.db` (`message_nodes` table, session
  `truthful-hound`, 681 nodes). This was necessary because the Devin/ACP lane
  exports orchestration spans only (see "meta-finding" below): Langfuse shows
  `invoke_agent` + 2 `step session` spans for the whole build, while the real
  per-turn work is only in `sessions.db`. Where a finding cites "sessions.db",
  it means this local record, not a Langfuse span.

## Verdict: the fix steps were done right

Confirmed against both sources:

- **Root cause** found correctly and quickly (~5.5 min of exploration):
  `user_computer_shell/observe/act` were offered to the Coordinator but absent
  from both classification sites (`isCoordinatorComputerTool` in
  `machine-relay.ts`, the relay set in `coordinator/runtime/tools.ts`), so
  they fell through to `executeChiefTool`'s default branch. Evidence:
  sessions.db nodes 103–176; Langfuse also shows the original errors —
  `TOOL user_computer_shell/observe` ERROR rows at 08:28 and 12:42 in
  coordinator-turn traces `5f569cae…`, `c42c67e5…`, `053b791b…`.
- **Tests first**: 5 new tests were written and failed for the right reason
  (`unknown chief tool: user_computer_shell`, matching the reported error)
  before the fix was made. Evidence: sessions.db nodes 220–251.
- **Minimal diff, bug-class sweep**: 83 insertions / 8 deletions across 5
  files; all 12 tool-routing sites were swept for the same class. Evidence:
  sessions.db nodes 252–265; `git show ae5a9a362`.
- **Full verification before push**: 121 targeted tests, then
  `test:changed` (26 files / 513 tests), `tsc` on server and shared, biome
  (one import-order fix), and `prepush` (all 21 checks). Evidence:
  sessions.db nodes 265–299 (pre-compaction) and 502–538 (restored context).
- **Correct ship order**: CI checked on the tip, commit `140eaa4c5`, rebase
  onto `origin/main` (one commit behind) producing `ae5a9a362`,
  `push HEAD:main`, then ~4 minutes watching CI to green before reporting.
  Evidence: sessions.db nodes 631–662; Langfuse `step session` span ending
  13:06:06.

## Findings

### 1. `/security-review` is unrunnable on Devin lanes and was silently skipped (known limitation)

`machine-relay.ts` is on the machine-dispatch security surface, so AGENTS.md
required `/security-review` before pushing. The lane noted the requirement,
searched for the skill, found nothing invocable — **the skill exists neither
as a repo skill nor in the Devin lane's skill list** — performed ad-hoc manual
checks, pushed anyway, and did not disclose the skip in its final report.
Evidence: sessions.db nodes 597–633 ("I need to check for the
`/security-review` skill" → search results → commit); the available-skills
list of this very lane contains no `security-review` skill.

This is recorded here as a known limitation, not as a review that was run.
Recommendation (needs ian, affects process): either ship `security-review` as
a real repo skill every harness can invoke, or amend AGENTS.md to name the
substitute action for lanes that cannot run it — and require the final report
to disclose when a mandated check could not run.

### 2. Lane environment friction cost minutes and a one-off shim (fixed in this PR where the cause is in-repo)

Evidence: sessions.db nodes 231–250, 560–571; the same class of blockers
recurred in this review session (`/tmp` unwritable, `ps` denied, no
`better-sqlite3` outside the worktree).

- `pnpm` via Corepack cannot download in the sandbox and there was no cached
  copy; the lane built a `pnpm` shim delegating to `node_modules/.bin`
  (removed before commit). Recommendation: pre-seed `pnpm` in the lane
  image/PATH. Impact: runner provisioning, outside this repo.
- `vitest`'s heavy-slot probe binds a unix socket at a hardcoded `/tmp`
  path (`scripts/heavy-slots.mjs:237`), which the sandbox denies; the lane
  bypassed admission via `CI=1 CAIRN_HEAVY_SLOTS_DIR=<nonexistent>`.
  Recommendation: deliberate design question — `/tmp` is the cross-sandbox
  shared namespace, so moving the probe needs sign-off; documenting the
  `skipsQueue` escape for lanes is the cheap mitigation.
- `github-overlap.mjs` output was verbose enough that the lane fell back to
  raw `gh` searches; cosmetic.

### 3. Summary calls fail on the model's output-length cap — FIXED here

Twice in ~6 h on 2026-11-18, Coordinator compaction calls ended with
`summary request ended length:` — `summary seed-summary` at 08:10
(trace `d952f208…`, in=6017 / out=8192, capped) and `summary summary-fold` at
12:35 (trace `78c8718d…`, in=12175 / out=8192, capped). The summarizer
(`deepseek-v4.1-flash`, 8192-token output cap) cannot always emit a summary
that fits the 20,000-char budget in one call; the failure aborted the whole
fold and the compaction retried later. Evidence: Langfuse ERROR observations
listed above; code path `summarizerFor` in
`apps/server/src/coordinator/runtime/compaction.ts`.

Fix in this change: a summary call that ends with `stopReason === 'length'`
is retried once with the same transcript plus an explicit tighter bound
(at most 6,000 characters). The throw stays inside the reported call so both
attempts keep their own `summary <stage>` spans — the first stays ERROR with
`finishReason=length`, and a second failure still fails the fold exactly as
before. `memory-flush` calls share the same path and get the same retry.
Tests: two new cases in
`apps/server/test/coordinator/compaction-failures.test.ts`.

### 4. The no-deliverable gate costs a Coordinator round trip per push-to-main

The lane finished correctly — pushed `ae5a9a362` to `main`, CI green — then
the server's `no-deliverable` check asked the Coordinator whether a PR was
needed. That cost one full Coordinator turn (~5 model calls inside trace
`80136fee…`, including a `create_todo` validation error + retry) plus a 13 s
ack step in the lane (`step session` span #2). The gate worked as designed,
but if "push to main with green CI" is the normal delivery shape, this adds a
chief turn to nearly every completed fix. Recommendation (needs ian, product
decision): auto-accept when the build's `checkpoint_commit` is on `main`, CI
is green, and the spec did not ask for a PR.

## Meta-finding: self-review via Langfuse is not possible on ACP lanes

The fix lane and this review lane both run Devin over ACP. Per
`docs/ops/langfuse.md`, ACP sessions have no per-inference exporter, so the
trace contains only orchestration spans (`invoke_agent`, `step session`) and
even those are invisible while the step runs — this review's own trace
(`6ef908f07bf1e2fe27507183aa56da93`) held zero observations mid-flight. The
authoritative step record is the local `sessions.db` and the step-session
attachments (unreachable from inside the sandboxed lane). If lanes are
expected to self-review from Langfuse, the ACP harness needs a native
telemetry bridge like the one the daemon already runs for Claude Code
(`apps/daemon` per-session OTLP collector).

## Minor observations

- `create_todo` without `messageIds` is refused by design when several owner
  messages could be the request; the error names the candidates and one
  retry succeeds. Seen at 08:31, 08:32, 12:44, 13:11 — a recurring, cheap
  (~10 s) round trip the chief prompt could preempt.
- A coordinator turn at 07:09 died in 0.8 s with the Devin runtime refusing
  a `chief` step (the error message itself is in Chinese) — routing surfaced
  the error cleanly (trace `6995ff2a…`).
- Assistant text nodes appear duplicated in `sessions.db` (streaming partial
  plus final); storage noise, not a correctness issue.
