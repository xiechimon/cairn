# #1025 verification evidence index — the first-round planning prompt injects the plan.md contract

Probe = `.claude/skills/verify-pacman/scripts/drive-1025-plan-first-round.mjs` (real daemon + 2 embedded stub LLMs + a Playwright browser face, self-spawned and self-recycled).
Run date 2026-10-08; stack = this branch's worktree (server 8791 / web 5273, scratch `PACMAN_HOME` = `.claude/verify-run/home`); daemon = this branch's code `tsx src/cli.ts start --foreground --server http://127.0.0.1:8791` (home `/tmp/pacman-1025-daemon-home`); stub LLM = embedded in the probe (the drive-904 .mjs shape transplanted, ephemeral port, one per leg to avoid cross-round interference).

**Conclusion: the first-round plan step's session prompt carries the plan.md contract (the canon composite-string shape), and the first round lands the plan row at v1 (no rewrite round); when the agent does not write in the first round, the chain's behavior is well-defined (the #113 rewrite round catches it, the #703 gate goes red).** Two independent runs were both **13/13 checks all green** (run A = 2026-10-08T14-04-09Z, run B = 2026-10-08T14-07-11Z; this directory archives run B's full set + run A's `result.json` copy).

## Two legs ↔ ticket seam mapping

| leg | shape | checks | pinned hop (red names the break point) |
|---|---|---|---|
| A | hosted repo, withPlan:true, the stub writes plan.md in the first round | 10 | the first step is kind=plan with zero prompt before the claim (the server does not move; the injection belongs to the daemon) → **the real request body's first user message received by the stub = the task text + the contract-instruction composite string** (the composeTaskPromptWithInstruction single-source shape, instruction last; not a code-read "looks like it") → the contract section verbatim (plan.md + the four section names) → the plan row lands at v1 in the first round (content byte-equal, planDocId pointing) → exactly one plan step and it is done (no rewrite round) → the transcript wire row `user-<stepId>` = the same composite string → the web confirm card `方案 · v1` + the composite line does not become a user bubble (the #612 nesting negative case) + the right-pane plan face's marker in full text |
| B | a bare directory without a repo, withPlan:true, the stub receives the contract but still does not write | 3 | **negative control**: the first-round request carries the contract the same way (the agent is "told and still does not write") → the #113 rewrite round is enqueued (a second plan step, prompt = the rewrite instruction) → the rewrite round still produces nothing → the #703 gate 1 closes it as failed (phase=failed, zero plan rows, errorMessage=`规划未产出方案`) — "missing artifact must go red", leg A's green is not theatrical green |

All three ground-truth kinds present: screenshots (`leg-a-confirm.png` / `leg-b-failed.png`) + request-body JSON (`leg-a-first-request-user-text.json` = expected/actual contrast) + SQLite rows (`leg-a-plan-row.json` / `leg-a-steps.json` / `leg-a-message-rows.json` / `leg-b-*.json`). `result.json` = the 13 checks itemized ok/label. The contract's expected text is independently restated in the probe (it appears on both sides — the shared single source and the restatement — and only if the two are verbatim equal is the injected thing proven to be the canon contract, not some other instruction).

## Rerun recipe

```sh
# stack (worktree lane; if the ports collide, bump VERIFY_PORT/VERIFY_WEB_PORT — do not kill the neighbor lane)
VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-pacman/scripts/launch.mjs
# probe (self-spawns stub x2 + the real daemon, recycles everything in finally)
env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY NO_PROXY='*' \
  VERIFY_REPO_ROOT=<worktree> DAEMON_HOME=/tmp/pacman-1025-daemon-home-<new-suffix> \
  node .claude/skills/verify-pacman/scripts/drive-1025-plan-first-round.mjs
node .claude/skills/verify-pacman/scripts/cleanup.mjs
```

The same stack can be rerun repeatedly (project/agent/provider/stub ports get a unique suffix per run); each run must use a fresh `DAEMON_HOME` (the probe rmSync-rebuilds it).

## Reading the results (the points a rerun will hit)

- **Leg B's failed terminal state is expected**: the negative control pins the rewrite-round catch + the gate's discriminating power, not a broken chain. A red B2 (no second plan step) is the real rewrite-round break.
- **Back-to-back reruns can hit the "zombie claim window"** (measured on this ticket: two hits and two passes; the pattern = starting a new run within <75s of killing the previous daemon): when a daemon is killed, its claim long-poll's `waitWake` is still hanging on the server side, and on expiry (≤75s) it runs `tryClaim` on behalf of the **dead machine** — the new run's pending step is claimed by the dead machine (the waiter Set is in insertion order, the zombie registered first and resumes first), the live daemon never sees the step, and everything stalls until the sweep fails it. Symptom = `waitFor timeout: leg A first stub request` + the step row's machineId non-empty / terminal state failed. **Avoidance: after killing the previous daemon, wait >75s (or re-launch the stack) before rerunning**. This is a real seam on the server claim face (suggested separate ticket: check the request's abort state before the second tryClaim in claimStep), not this ticket's territory.
- **message.content is a drizzle json column**: string values are stored with quotes (the #902 pit); the probe JSON.parse-strips the quotes before asserting — that is exactly how A5's assertion is written.
- **vite dev cold compile**: the probe warms `/app` before creating tasks (same as drive-918).
- Budget: leg A confirm 300s, leg B 240s; on a warm stack a real single run takes <30s end to end (stub delay 500-1500ms).
