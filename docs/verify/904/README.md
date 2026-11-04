# #904 verification evidence index — the plan.md persistence channel full chain (withPlan build → plan table → confirm has something to show)

Probe = `.claude/skills/verify-pacman/scripts/drive-904-plan-chain.mjs` (real daemon + stub LLM x3 + a Playwright browser face, self-spawned and self-recycled).
Run date 2026-10-07; stack = this branch's worktree (server 8791 / web 5273, scratch `PACMAN_HOME` = `.claude/verify-run/home`); daemon = this branch's code `tsx src/cli.ts start --foreground --server http://127.0.0.1:8791` (home `/tmp/pacman-904-daemon-home{,-r2}`); stub LLM = embedded in the probe (the drive-918 .mjs shape transplanted, ephemeral port, one per leg to avoid cross-round interference).

**Conclusion: the channel is intact.** Two independent runs were both **20/20 checks all green** (run 1 = 2026-10-07T18-00-31Z, run 2 = 2026-10-07T18-01-38Z; this directory archives run 2). The "#892 measured-evidence '28 builds / 0 plan.md rows / 0 samples'" is therefore **not a channel break** but a traffic-free usage face: the web's todo-start entry goes through the chief orchestration round (`use-new-task-surface.ts:152`), and the chief dispatch prompt hard-wires `withPlan:false` as the default (`chief.ts:790`, evidenced 8/8) — the choice of "dispatch via plan" belongs to the #892 §6 suggestion 4 (a separate ticket), outside this ticket's territory.

## Three legs ↔ ticket seam mapping

| leg | shape | checks | pinned hop (red names the break point) |
|---|---|---|---|
| A | hosted repo, withPlan:true | 10 | plan step enqueued kind=plan → claimed by the real daemon (step.machineId) → agent bash writes plan.md → daemon collects and uploads → **plan table row lands at v1, content byte-equal to what the agent wrote, build.planDocId pointing at that row** → step done → phase=confirm + hasPlan=1 → REST `/api/builds/:id/plans` 200 with exactly one byte-equal version → web confirm card `方案 · v1` + preview = first valid line of plan.md → the right-pane plan face keeps the full-text marker on screen → the full text still held after clicking `打开方案` |
| B | bare task directory without a repo, withPlan:true | 7 | live-stack proof of the #703 fix face (before, a withPlan build with no repo never produced a plan): same byte-equal row landing + confirm + hasPlan + REST + card/plan faces |
| C | negative control: the agent writes no plan.md in either round | 3 | **missing artifact must go red** (proving A/B's green is not theatrical green): no artifact in round one → the #113 auto-rewrite step is enqueued (a second plan step, prompt containing `plan.md`) → the rewrite round still produces nothing → the #703 gate 1 closes it as failed (phase=failed, zero plan rows, build.errorMessage=`规划未产出方案`, chip=`失败`, zero plan cards) |

All three ground-truth kinds present: screenshots (`leg-{a,b}-confirm.png` / `leg-{a,b}-docpane.png` / `leg-c-failed.png`) + API JSON (`leg-a-plans-rest.json`) + SQLite rows (`leg-*-plan-row.json` / `leg-*-build.json` / `leg-*-steps.json` / `leg-*-todo.json`). `result.json` = the 20 checks itemized ok/label. Marker shape `PLAN-904-MARKER-{A,B}-<runTag>` (unique per run; the byte-equality assertion uses it to rule out the "read back your own previous round" false positive).

## Rerun recipe

```sh
# stack (worktree lane; if the ports collide, bump VERIFY_PORT/VERIFY_WEB_PORT — do not kill the neighbor lane)
VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-pacman/scripts/launch.mjs
# probe (self-spawns 3 stubs + the real daemon, recycles everything in finally)
env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY NO_PROXY='*' \
  VERIFY_REPO_ROOT=<worktree> DAEMON_HOME=/tmp/pacman-904-daemon-home-<new-suffix> \
  node .claude/skills/verify-pacman/scripts/drive-904-plan-chain.mjs
node .claude/skills/verify-pacman/scripts/cleanup.mjs
```

The same stack can be rerun repeatedly (project/agent/provider/stub ports get a unique suffix per run); each run must use a fresh `DAEMON_HOME` (the probe rmSync-rebuilds it).

## Reading the results (the points a rerun will hit)

- **Leg C's `失败` chip is expected**: the negative control pins the gate's discriminating power (no plan.md, no confirm admission), not a broken chain. A red on leg C (phase=confirm or a plan row present) would mean the #113/#703 gates failed — that is the real break point.
- **Leg A hosted relies on the server self-hosting a bare repo** (`<PACMAN_HOME>/server/repos/<teamId>/<repoName>.git`, initialized + seeded main at project creation); git goes through the per-step `issueStepGitCredential` issuance, and the probe's api-key still carries `gitAccess:true` as a fallback.
- **plan.md byte-equality includes the trailing `\n`**: the heredoc `cat > plan.md <<'EOF'` write = content lines + a final newline; the expected value is built as the same-shaped string (`planDoc()`) — off by one newline and A3/B1 go red.
- **Stub call ids must be unique per run** (the message table's primary key = call id, the upsert does not touch conversationId — reuse across runs pins tool rows into the old session; the 918 gotcha, the probe builds in a runTag).
- **vite dev cold compile**: the probe warms `/app` before creating tasks, otherwise the detail page's first visit arrives late and the card assertions time out on an empty DOM.
- Budget: leg A confirm 300s, legs B/C 240s; a real single run takes about 3 minutes end to end (stub delay 500-1500ms).
