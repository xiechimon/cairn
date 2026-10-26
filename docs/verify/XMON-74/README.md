# XMON-74 / XMON-115 permission closed-loop live verification evidence

Full-chain evidence on an isolated stack (verify-pacman: server 8791 + vite 5273 + scratch PACMAN_HOME, fresh library) exercising real HTTP, real UI (Playwright chromium 1440x732) and real SQLite. 25/25 checks PASS; per-item details in `result.json`.

## Reproduction

```sh
# stack (from the worktree root):
VERIFY_REPO_ROOT=$PWD node .claude/skills/verify-pacman/scripts/launch.mjs
# probe (one-off script, archived with the evidence; reclaim with cleanup.mjs after the run):
node docs/verify/XMON-74/xmon74-probe.mjs
```

## Evidence chain (mapped to XMON-74's three questions)

| question | evidence | conclusion |
|---|---|---|
| Q1: are all switches off by default | `01-agent-created-defaults.json` (create agent over REST → `tools:["推送分支"]`) + `02-perms-default.png` (permissions tab's six switches: remote shell OFF, `推送分支` ON) | not all off: a new agent defaults to `AGENT_TOOL_DEFAULTS=['推送分支']`, the other five tiers off (XMON-84 decision B4) |
| Q2/Q3: chief authorization write closed loop | `03-claim1-remoteTools.json` (chief-step claim carries the 50-entry vocabulary incl. `set_remote_shell`) → `04-relay-grant.json` (relay grant → `tools:["推送分支","远程 shell"]`) → `05-agent-get-after-grant.json` (REST GET same value) → `06-sqlite-agent-row.json` (SQLite row same value) → `08-perms-chief-granted.png` (UI switch ON) | chief relay and REST PATCH write the same `agent.tools` field, both through `filterAgentTools` — two entries, one truth |
| guard face | `07-relay-revoke-guard-regrant.json`: revocation removes only the shell and leaves `推送分支` untouched; a nonexistent agentId → 404 and no write | out-of-authority / mistaken writes fail closed |
| enforcement consumption face (both gates) | `07b-chief-dispatch-workers.json` (chief `run_builds` directly assigns two worker steps) + `10-worker-claims-localTools.json`: worker1 with the agent switch on ∩ machine `shellEnabled=false` → `localTools:[]` (fail-closed); after `09-machine-shell-enabled.json` opens the machine gate, worker2 → `localTools:["remote_shell"]` | the tool is registered only when the agent switch ∩ machine switch are both open (XMON-108 R1: single judgment source `claimLocalTools`) |

Note: the chief-step claim carries no `localTools` (the chief has no local execution face, XMON-108 R1 design; the preflight endpoint 409s chief steps); the both-gates consumption point is the worker-step claim — the `localTools:[]` in `03` reflects that design, it is not evidence of the gate being closed; the closed/open comparison is in `10`.
