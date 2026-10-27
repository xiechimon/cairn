# ADR 0016 · Machines are disposable: state lives off the machine; localPath degrades to a single-machine cache

> Status: **Decided** (2026-10-10). Map ticket #1147; this document's landing ticket #1152.
> Trigger: the user's target shape — develop on a VPS / idle machine at any time, tasks keep running while the local computer is off; a cloud machine dying loses neither progress nor development state.
> Successor: ADR 0017 (dual execution sources) — github-shape projects can additionally mount localPath as a same-machine execution accelerator; this ruling is unchanged, disposability still belongs to githubRepo only.

## Problem Statement

To get "any machine can develop, and a machine's death loses no progress", first answer where the truth lives. Two candidates:

- **State follows the machine** (Amp orb mode): one machine per thread, volume snapshots + hibernate-and-resume, kept alive by the platform. The premise is the platform's unlimited supply of VMs and a snapshot substrate — self-owned hardware has none.
- **State lives off the machine**: all truth is pushed off the executing machine; the machine is a pure cache; "recovery = another machine re-materializes + continues from the thread".

## Recon facts

| # | Fact | Source |
|---|---|---|
| F1 | The truth of tasks / threads / plan docs lives in the server DB, not on the executing machine | repo schema + CONTEXT.md |
| F2 | The truth of code lives in the git remote: the daemon commits+pushes at the end of every step (step-boundary granularity, covering both the github and local shapes after hosted removal) | the wrap-up surface in `apps/daemon/src/runner.ts` |
| F3 | Uncommitted changes within a step are the only losable surface; pushing WIP mid-step could shrink the window to minutes but adds noise to git history — Multica has not even step-boundary commits (loses the whole workspace); pacman's status quo is already one tier better | r10 §5, ruling record #1147 |
| F4 | Multica's squad-leader tasks have **no concurrency exemption** (`CountRunningTasks` counts all); the coordinator's anti-stall relies on per-agent quotas + the upstream #7344 directory-lock exemption | 2026-10-10 shallow-clone re-check: `daemon.go:5349` / `agent.sql:1780` / `local_directory.go:108-150` |
| F5 | pacman's chief is an independent entity, not "one of many agents"; per-agent quotas have nothing to port | CONTEXT.md "executing entities" section |
| F6 | The mature form of environment rebuilding = in-repo lifecycle hooks: `.agents/setup` (idempotent provisioning, timeout kills the tree) + `.agents/resume` (wake-up repair) | `docs/research/amp-native-sandbox-orb.md` §3.2 |
| F7 | For the localPath shape, the truth is exactly that machine's file system — when the machine dies, even the committed parts are unrecoverable | CONTEXT.md "repo" entry (pre-amendment) |
| F8 | The server deploys inside the tailnet (mea), GitHub webhooks cannot reach in; CI status can only be polled | #1147 ruling 6 |

## Decision

1. **State lives off the machine**: task truth in the server DB, code truth in the git remote, environment truth in the in-repo `.agents` hooks (F6); a machine is a disposable cache. No cross-machine migration, no hibernating-volume resuscitation, no container layer (same-machine concurrency collisions are covered by the `PACMAN_PORT_BASE` port base; see #1148).
2. **No WIP pushes** (F3): a machine's death loses "the uncommitted changes within the current step since the last step boundary"; that window is accepted. Reasoning: the noise cost on git history > the expected loss of intra-step work in the self-use scenario; the Multica same-position comparison (which is worse) shows this is not a lag.
3. **localPath degrades to a "single-machine cache" shape** (F7): not cut (useful for fast local trials), but the CONTEXT.md entry and the project-creation surface permanently state "if the machine dies, progress goes with the machine"; disposability belongs to `githubRepo` only.
4. **chief steps occupy no concurrency slot** (F4/F5): the concurrency cap governs worker steps only; the chief is a dispatcher, not a laborer, and must never be starved by workers filling every slot.
5. **Server pinned always-on + scheduled DB backups**: the control plane is the only single point (F1); mea stays on to host it; `sqlite3 .backup` ships to dmit hourly (RPO 1h); restore drills belong to #1151.

## Premortem (assuming this ruling is wrong: the three most likely failure modes)

1. The server DB is genuinely lost (mea's hardware dies + the backup chain breaks in the same event) → guardrail = #1151 hourly backups + offsite-copy restore drills; RPO 1h is written into the ticket.
2. "localPath degrades" is misread as "localPath is unusable" → guardrail = the UI label states only the fact (progress goes with the machine) and does not disable anything; the entry writes down where each shape's truth lives.
3. chief not occupying a slot oversubscribes a small-memory machine (cap + K chief turns squeeze it) → guardrail = chief turns are lightweight orchestration conversations; if it really collides, add a chief concurrency soft cap then — this ADR reserves nothing.
