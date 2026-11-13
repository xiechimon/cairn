# #1251 capability reporting + dispatch capability gate + visible pending causes — live acceptance

Probe: `.claude/skills/verify-pacman/scripts/drive-1251-capability-gate.mjs`
(fake machine wire + real-browser clicks + one real-daemon leg; zero LLM).
Result: `result.json` 15/15 PASS (checks itemized ok, no rounding).
The archived evidence is the product of a rerun on the merged tree after #1257 (the pending hang law) landed — a capability-blocked pending step does not close as failed under the new law; the visible cause is carried by queue.blocked (step level) and todo waitingOn (board level); this probe's criterion faces (claim gate / read faces / real-daemon reporting) are the same shape under both laws.

## Rerun recipe

```sh
# 1. the server-side MCP projection vocabulary fixture (the probe's UI leg flips the figma-required switch;
#    if the vocabulary is uncertain it stops with a hint to re-launch):
printf '%s' '{"mcpServers":{"figma":{"type":"http","url":"https://mcp.figma.com/mcp"},"ctx":{"type":"stdio","command":"npx","args":["-y","@upstash/context7-mcp"]}}}' \
  > /tmp/pacman-1251-server-mcp.json
# 2. the isolated stack (lsof-check the ports per lane discipline first):
PACMAN_MCP_CONFIG=/tmp/pacman-1251-server-mcp.json \
VERIFY_PORT=8803 VERIFY_WEB_PORT=5283 VERIFY_REPO_ROOT=<worktree> \
  node .claude/skills/verify-pacman/scripts/launch.mjs
# 3. run the probe (requires a fresh library; re-verify = cleanup + re-launch):
VERIFY_PORT=8803 VERIFY_WEB_PORT=5283 VERIFY_REPO_ROOT=<worktree> \
  node .claude/skills/verify-pacman/scripts/drive-1251-capability-gate.mjs
# 4. close out: cleanup.mjs (the evidence is not deleted); archiving = cp into docs/verify/1251/ with the PR.
```

## Reading

| file | artifact |
|---|---|
| `r2-heartbeat-tolerance.json` | the heartbeat red line: three bad shapes of presence capabilities each get 200 {ok:true}, the row keeps the old values |
| `g2-machine-fit-blocked.json` / `g2-agent-machine-fit-blocked.png` | the machine-fit three states: a machine missing an entry has canRun=false + a readable missing shape + mcpGaps reconciliation; a non-reporting machine has missing=null and canRun=true (fail-open); the browser permissions tab's machine-fit section shows the same state (switch ON, red `不可跑`, the missing-entry remedy line) |
| `g5-queue-blocked.json` / `g6-queue-blocked-row.png` | the steps read face queue.blocked = capability-missing + the detail page's queue line `没有机器满足能力要求（缺 MCP server "figma"）——装齐后下一拍心跳即解锁` |
| `g8-machine-fit-clear.json` / `g8-agent-machine-fit-clear.png` | after the presence installs figma, the same machine claims immediately (the remedy closes the loop instantly) + the fit cleared state |
| `g9-machines-capability-annotation.png` | the machines page reads the annotation in two states: the `MCP 2 · 本机技能 0` count shape vs `能力清单未上报（旧版 daemon）` |
| `d1-daemon-log-tail.txt` | the real-daemon leg's log tail (the register/online sequence lines); the SQLite ground truth is in result.json's D1 detail (probe-mcp lowercased + bad entries skipped + probe-local-skill) |

## Measured pitfalls (exposed on the first run, fixed into the probe)

1. **A screenshot and an API criterion from different sources = false evidence**: a successful PATCH → invalidateAll triggers a whole-page refetch; the first run's g2 screenshot raced ahead of the refetch settling and captured the pre-click old state (switch OFF, fit `可跑`) while the API criterion already passed. The fix = wait for the UI to settle before screenshotting (waitFor on the switch's aria-checked=true + the `不可跑` judgment word). The same law applies to any "click then screenshot" probe.
2. **run_builds auto-watch inserts a chief gate round step** (same gotcha as drive-1250): both the empty-hand judgment and the post-unlock claim must distinguish "claimed a gate round (collect it and claim again)" from "claimed a gated step (hard failure)".
3. **The empty-hand evidence for a claim = the client's 5s cut + the SQLite step still pending, double insurance**: the server hold is ≈75s and waiting it out is too slow; #1065 guarantees a cut request does not claim steps on behalf of a dead machine.
4. **The machines page route is `/app/resources/machines`**, not `/app/machines` (the first run's timeout root cause).
