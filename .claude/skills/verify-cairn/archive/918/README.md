# #918 verification evidence index — the live row and the detail showing "which skills were read" (including events blocked by deny)

Probe = `.claude/skills/verify-pacman/scripts/drive-918-skill-facts.mjs` (real daemon + 2 embedded stub LLMs + a Playwright browser face, single-phase full chain). Run date 2026-10-07; stack = this branch's worktree (server 8791 / web 5273, scratch `PACMAN_HOME`); daemon = this branch's code `tsx src/cli.ts start --foreground --server http://127.0.0.1:8791`, with an independent scratch home (`/tmp/pacman-918-daemon-home`) + `PACMAN_SKILLS_DIR=/tmp/pacman-918-skills` (the probe drops the fixture automatically: authorized `demo-skill` + `extra-skill` outside the whitelist).

**13/13 checks all green** (`result.json`), ticket acceptance seam mapping:

| acceptance seam | evidence | criterion |
|---|---|---|
| real user path: the live row surfaces skill entries in real time | `live-panel.png` | while the step runs, expand the live-row disclosure face and `▶ skill: demo-skill` is listed (data-testid `skill-line`); the wire face `activity-wire.json` corroborates (the `skills` accumulating set on the activity event + the tool phase display name `skill: extra-skill`) |
| deny events visible on the same line | `live-panel.png` | the same disclosure face shows `✕ skill: extra-skill（已挡下）` (the tool-error refusal from the #917-gated read); on the SQLite face `messages-918a.json` the refusal copy `not in the agent allowlist` lands in the DB |
| step detail page summary | `summary.png` | after the step's terminal state, the summary line `技能：demo-skill · 挡下：extra-skill` (data-testid `skills-summary`, derived from the persisted toolcall row — still present after the activity transient is cleared) |
| control group: zero skill hits yield zero entries | `control.png` + `activity-wire-control.json` | the second task (another agent/stub, the script reads zero skills): no summary line and no entry lines on the detail page; the wire has activity events (5) but none carries a `skills` field |
| stepId filtering | `activity-wire.json` + web unit test W8 | every event is stamped with this step's stepId; stale-step activity does not attach to the current streaming item (the consumption side pinned by `apps/web/test/activity-live-row.test.ts` W8) |

## Rerun recipe

```sh
node .claude/skills/verify-pacman/scripts/launch.mjs            # VERIFY_REPO_ROOT=<worktree>
env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY NO_PROXY='*' \
  node .claude/skills/verify-pacman/scripts/drive-918-skill-facts.mjs
# the probe self-spawns/self-recycles: stub LLM x2 (ephemeral ports) + the real daemon (--server points at this stack)
```

## Reading the results (the five points a rerun will hit, all stepped on in real runs)

- **Writing the agent whitelist goes through the server's live-catalog validation**: the `skills` on `POST /api/teams/:id/agents` are filtered by `filterKnownSkillIds(ctx.skillsDir)` — **names absent from the server-side skill catalog are silently dropped** (first run, measured: present on the daemon but not on the server → `skills=[]` → both skills fully denied, and the authorized read becomes a refusal too).
  The fixture must land in both places: the daemon's `PACMAN_SKILLS_DIR` + the stack home's `skills/`.
- **The step's success terminal word = `done`** (shared `stepStatusSchema`), not `success` — the 920 probe writing `'success'` is a latent typo that never surfaces in its failed-step-only shape; do not copy it.
- **The stub's tool call id must be unique per run**: the message table's primary key = call id, and an upsert conflict does not touch `conversationId` — reusing the same id across runs pins this round's tool rows into the previous round's session (measured on the fourth run: this round's session missing tool rows → the summary line never appears).
- **daemon.log lines carry a wall-clock prefix** (#735): liveness waits like `[wake] push channel connected` must substring-match, never compare the whole line.
- **The live-row disclosure face's expanded state is in-component state**: transcript entry changes remount LiveRow and collapse the panel (the #905 panel's same existing behavior, out of this ticket's scope) — the probe re-expands it in its polling loop; also, a cold stack's first visit can take tens of seconds of vite compiling, so the probe warms up before creating tasks, otherwise the detail page lands after the step has already terminated.
