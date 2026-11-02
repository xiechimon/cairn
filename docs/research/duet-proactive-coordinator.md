# Claude Duet and a proactive Coordinator

Read 2026-11-02. Claude Duet is waitlisted (US, Pro/Max/Ultra), so this is from Anthropic's published pages, not from operating the product.

Sources:
- Product page: https://claude.com/product/claude-duet
- Launch article: https://claude.com/resources/articles/claude-duet
- Safety article: https://claude.com/resources/articles/claude-duet-safety-privacy-and-security

## 1. What Duet does

| Concern | Duet (as published) |
|---|---|
| Daily rhythm | One morning brief of "the most important items across your connected apps", with drafted next steps. A dashboard in the demo refreshes before the brief. |
| Rest of the day | Checks connected accounts "every few hours" and messages only when something needs the user. The interval was chosen to conserve plan limits; background checks count against the user's quota. |
| Reporting work | Notifies when a delegated task finishes or needs a decision; returns the artifact for review. |
| User control | The user tells it "what you want to hear about and how often". No published settings surface. |
| Urgency | Model judgment only; no published rules. Known weakness: "may misread a thread or miscalibrate what's urgent", and it misses things that arrive between checks. |
| Thread and memory | One ongoing thread for everything; reuses the Claude account's memory, skills and connectors. |
| Approvals | Sending, paying, signing and deleting show the exact action and wait. The check runs outside the working model so page text cannot approve it. Some actions are blocked even with approval. Anthropic calls approval fatigue "a serious issue". |
| Learning | No per-user retro or feedback loop is published. |

## 2. What cairn already has

- Event wakes: watched todos wake the Coordinator on `gate`, `settle` and `failed` (`apps/server/src/services/chief.ts` `triggerChiefWakes`).
- Timed wakes the Coordinator sets itself (`setChiefWake`, `fireDueChiefWakes`).
- A daily 08:00 digest (`apps/server/src/services/chief-digest.ts`, `CHIEF_DIGEST_HOUR`): a read-only run per thread that groups the conversation into decided / done / open / remembered and writes `remembered` items to memory. Its input is the chat, not the ledger.
- Push digest slots (`scheduler.ts`, `sweepPushDigest`).
- Open tickets on the same path: #1784 (push only when a human is needed, fold the rest into the daily brief; already cites Duet), #2488 (watchdog), #2493 (observe-first for new autonomous triggers), #2522 (current-state brief from ledger tables), #2577 / D60 (Coordinator as a thin router that chooses push now or digest).

## 3. Gaps against Duet plus the requested retro

1. **No outward morning brief.** The 08:00 digest compresses chat for memory. Nothing tells ian "yesterday: N merged, M failed or retried, K waiting on you, today's queue", built from the ledger.
2. **No periodic sweep of the outside world.** PR staleness, CI, the omarchy deployed SHA versus main and quota are checked by hand in dev-workflow coordinator sessions today. Duet's "every few hours, speak only when needed" maps to #2488 plus #1784.
3. **No retro.** Duet has none, so this is cairn's own addition. The method exists in `.claude/skills/retro-cairn/SKILL.md` (mistake → attribution → safeguard landed in code), but only as a dev skill a session runs by hand.
4. **No "what to hear and how often" setting.** #1784 plans a per-user fyi toggle and quiet hours only.

## 4. Duet versus the DSH super-agent

DSH column from `docs/research/dsh-sig-walk-2026-11.md` (prototype `deepseek-ai/dsh-superagent-prototype` at `6337fc82`). Both are proactive in different directions: Duet reaches the user on a clock, DSH decides on incoming events whether to take work.

| Concern | Claude Duet | DSH super-agent |
|---|---|---|
| Serves | One person's work apps (mail, calendar, Slack) | One GitHub repository (optionally Feishu); many people mention it |
| Trigger | Time: morning brief, checks every few hours, plus user messages | Events: Issues, PRs, comments, CI; the router may not sleep or poll |
| Taking work | Model judgment, no published rules | Deterministic gate, then a model assessment against accept rules; an accepted Ticket carries an immutable Mandate |
| Who does the work | Duet itself, on its cloud VM and browser | Never the router; one worker session and worktree per Ticket |
| Threads | One thread for everything | Subscriptions: later events on a thread go straight to the owning worker |
| Attention | Morning brief, then only when needed | One acknowledgement, then silence; the panel lists only Tickets waiting on a person; no daily brief |
| Approvals | Per sensitive action, checked outside the model | Authorization fixed at intake by the Mandate; workers then run with `danger-full-access` |
| Staged autonomy | Not published | `off` / `observe` (default, records "would accept") / `auto` |
| Memory | The Claude account's memory | None; continuity is structural SQLite state |
| Watchdog | Not published | Hourly `status` check from another profile; no progress judging |
| Retro | None | None |

Implication (inferred): they complement each other. D60 (#2577) already takes DSH's skeleton: a thin router and the subscription fast path (#2487). DSH has no clock toward the user, so the brief and daytime sweep come from Duet, quiet by default (#1784). Retro is in neither; roll it out with DSH's `observe` staging (#2493). Keep cairn's DSH-like intake authorization plus the merge gate for execution; Duet-style per-action approval fits only where the Coordinator speaks for ian outward (Feishu, GitHub comments).

## 5. Recommendation

Build it in the product Coordinator, not as more Claude Code scripts, and keep it inside D60: the Coordinator delivers and routes, and a read-only run does the work, the same way the digest already runs in its own thread with a read-only tool set (`CHIEF_DIGEST_REMOTE_TOOLS`).

Order:
1. **#1784 first.** Quiet by default is the precondition; a brief on top of today's per-phase pushes adds noise.
2. **Daily brief** (extend `chief-digest.ts`, one run per Coordinator, not per thread): inputs from ledger tables per #2522 (todos, steps, PRs, merge verdicts, deploy SHA, quota waits), sections Yesterday / Needs you / Today / Retro. One Coordinator message and one push.
3. **Retro section, observe-first (#2493).** Collect yesterday's failed steps, retried CI rounds, reverted or reworked PRs and user corrections; attribute each; propose a safeguard as a draft todo that ian confirms. Nothing is created or merged automatically until the proposals prove useful.
4. **Daytime sweep** via #2488 at a fixed interval, silent when healthy.

Cost constraint (inferred): the Coordinator runs on the Pro token stored on omarchy, and Duet chose "every few hours" to protect plan limits. One brief per day plus a few silent sweeps is cheap; an hourly model run is not. Sweeps should be deterministic checks that call the model only when a check fires.

## 6. Open questions for ian

1. Brief time and channel: keep 08:00 in the Coordinator thread plus one push, or Feishu as well?
2. Retro scope: only failures and corrections from the product's own ledger, or also the dev-workflow sessions (Claude Code transcripts, GitHub)?
3. Retro proposals: draft todos needing confirmation (recommended), or straight into the queue?
