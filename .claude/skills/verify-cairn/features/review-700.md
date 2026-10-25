# review-700 — the verdict-extraction real chain (#700 B-C13)

Ticket: #700 (B-C13, measured at #519: after the review step's verdict JSON, `set_task_meta` is called again, and the `审核结论` is silently dropped). The probe walks the **real daemon full chain** (unlike drive-review-blocking's server-direct done injection, which does not enter the daemon's extraction surface), the stub replaying the #519 shape — the verdict JSON text and the set_task_meta tool call are emitted in the same round, and the daemon transcript's row order = the text row first, the tool row second (exactly the shape that defeated the old extractor).

## Coverage

- Scenario B (the extraction-failure surface): the stub's pure prose -> the daemon's `findingsError` -> the server verdict message's conclusion `判定提取失败` + the `extractionError` reason floats up -> the web review surface's danger-colored tag row (distinct from the old fallback `审核未返回结论`) -> no revision is triggered (the phase stays confirm, no new plan step).
- Scenario A (the #519 shape surface): the verdict JSON + the trailing set_task_meta tool row -> the verdict is extracted as usual (the findings land in the DB) -> blocking -> the review -> planning reflow (the revise note + the re-planning step enqueued + the prompt carries the review facts) -> set_task_meta really executes (the todo title is rewritten).
- The stub answers the re-planning round (the daemon-delivered CONTINUE_PROMPTS.plan text) **with a 30s delay** = the planning-phase window is held open, the assertions are race-free; the probe's close cleanup discards the whole stack, that step is not closed.

## How to get to it (user POV)

- The task detail page (`/app/todo/:id`) in the confirm phase -> the composer's `AI 审核` button launches the review (the same entry as [review-modal.md](./review-modal.md)); once the review step finishes, the conclusion lands in the conversation: scenario A = the verdict row and the findings with a reflow to planning, scenario B = the `判定提取失败` danger-colored tag row.
- Driving: this feature has no current case; all registered ones are judged stale and refuse to run without `--force` (the refusal prints the reason), `vp.mjs list review-700` lists the usage:
  - `vp.mjs drive review-700 verdict-extraction`: its dependency setup-review-700-seed.mjs creates the agent without machineId, 400 since ADR 0019.

## Preconditions and how to run

```sh
# 1. Stack (worktree code)
VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-cairn/scripts/launch.mjs
# 2. Stub (tiers see the script's header comment; markers: EXTRACT-FAIL-MARKER = scenario B / Blocking findings = the delayed re-planning round)
STUB_PORT=8921 node .claude/skills/verify-cairn/scripts/stub-review-700.mjs &
# 3. Seed (two todos = the two scenarios; the provider baseUrl points at the stub)
VERIFY_REPO_ROOT=<worktree> STUB_LLM_URL=http://127.0.0.1:8921/v1 \
  node .claude/skills/verify-cairn/scripts/setup-review-700-seed.mjs   # stdout JSON
# 4. Real daemon (the 4th process, cleanup.mjs does not reap it — start and collect it yourself)
cd <worktree>/apps/daemon && env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  -u all_proxy -u ALL_PROXY CAIRN_HOME=/tmp/cairn-review700-daemon-home \
  corepack pnpm exec tsx src/cli.ts start --foreground \
  --server http://127.0.0.1:8791 --api-key <the seed's apiKeyPlain> \
  --team <the seed's teamId> --name review-700-mbp
# Wait until GET /api/teams/<teamId>/machines shows online:true
# 5. Probe
VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-cairn/scripts/drive-review-700.mjs <todoA> <todoB>
```

## Gotchas

- Unset **all 6 proxy env vars** at the daemon start + an explicit scratch `CAIRN_HOME` (the pass-through pitfall is in stop-button.md) — otherwise enroll 401s / pollutes `~/.cairn`.
- Run scenario B before A: B's terminal state is stable (no revision triggered); A's re-planning round is held open by the stub's delay, the probe cleans up the moment it ends.
- The seed's plan step is claimed/done by the seed itself (before the daemon starts); the daemon starts after the seed and only touches the review / re-planning steps.
- The stub's round discrimination **must not** use `body.includes('tool')` (the tools definition array contains that word) — judge the second round by the `messages` containing a `role:'tool'` row.
- **The re-planning-round criterion = `请重新规划该任务` (the CONTINUE_PROMPTS.plan text)**: what the daemon delivers for a continue-session plan step is the generic continuation-round instruction — the REVIEW_REVISE_PROMPT stored in the step table does not go through the claim-instruction surface (the review facts reach the agent via the continued session's history). Taking 'Blocking findings' as the criterion never hits, and the delayed round degenerates into a planning-window race (stepped on in the first run).
- The `content` returned by the messages API is the **parsed value** (a block array / a toolcall object / a string) — stringify before matching.
