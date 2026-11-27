---
name: verify-cairn
description: Behavior verification for cairn - spin up an isolated live stack (server VERIFY_PORT 8791 + vite dev VERIFY_WEB_PORT 5273, independent CAIRN_HOME scratch), Playwright walks real user journeys (new task / create API key / search / theme), evidence (screenshots + API JSON + SQLite rows) available for review with optional repository archiving. Use when you must prove a feature really runs after a change and need reviewable evidence; fixture-surface regression goes through apps/web e2e (including the visual specs' geometric assertions), not this skill.
---

# verify-cairn

cairn = a React/vite web + Hono REST/SSE/SQLite server. This skill spins up an **isolated instance** (own ports, own data root; never the real `~/.cairn` or the live dev stacks on 8787/5173), walks real user journeys with the repo's Playwright chromium, produces evidence, then cleans up. Scripts live under `scripts/`; runtime state and evidence live under `.claude/` (gitignored).

Surfaces: the web UI (`apps/web`, vite dev proxying `/api` and `/git` to the server) and the HTTP API (`apps/server`). The daemon is optional. The seeded owner is auto-logged-in. Live mode = a URL **without** `?scenario=` (`?scenario=` is the e2e fixture face). Observe through screenshots (1440x732), API JSON (`/api/user/me`, `/api/todos`, `/api/teams`), read-only SQLite (`<CAIRN_HOME>/server/server.db`) and the server and web logs.

Start from the feature map [feature-map.md](feature-map.md) (generated from `feature-map.json`): per feature, its states, reach steps from a fresh page load, routes, settings path, shortcuts and test ids. Match a report or screenshot to a feature, follow its reach steps, then drive the recipe it links under `features/`.

Control Glass journeys (new task, dispatch, review diff, request changes, merge): `.cursor/skills/verify-cairn/SKILL.md`, contracts in `features/glass-journeys.md`, one command `node .cursor/skills/verify-cairn/scripts/glass.mjs`.

Change history: one file per ticket under `changelog/` (`<date>-<ticket>.md`, convention in `changelog/README.md`). Record a new entry by creating a new file; never edit old entries or this file for it.

Shipped-app regressions: [post-install-regressions.md](post-install-regressions.md) lists every behavior that regressed in a released desktop build and the check guarding it in `scripts/smoke/post-install.mjs` (run by `desktop-release` before publish). A verified fix that later regresses gets a row and a check there.

## Evidence limits checklist

Apply this checklist before reporting verification or handing off a delivery. For each acceptance claim, record the command, tested commit, app surface (fixture or live), provider mode (stub, real, or not exercised), artifact path, result and remaining limits. Mark an unavailable check as unverified rather than widening a narrower result.

- Fixture screenshots cannot establish real-app behavior. Keep focused fixture UI and visual regression tests; label them as fixture evidence. Verify claims about the real app on an isolated live stack without `?scenario=`, using the relevant API, database or runtime observations alongside screenshots.
- Stub-only runs cannot establish real-provider behavior. Keep deterministic stub regressions, including real-daemon protocol and orchestration checks; name the stubbed boundary and limit the claim to the exercised layers. A real-provider claim requires a real-provider run with recorded provider mode and runtime evidence; if credentials or access are unavailable, report that claim as unverified.
- Make supporting evidence readable: do not commit it to the repository (`main` has no `docs/verify/`); keep it in the gitignored evidence directory and link or describe it where you report. Preserve ordinary reference links as references; embed image links and check that they are reachable.
- Mechanism claims require compiled or runtime evidence of the claimed effect, such as compiled CSS, observed animation state, actual wire payloads, runtime logs or schema snapshots. Source, configuration and installed dependencies alone do not establish that the mechanism took effect. Record the artifact and the assertion it supports.
- Separate automated checks from review: no check judges evidence sufficiency, live-app origin or real-provider execution, so state them yourself and label stub-only runs as such.

The implementer templates incorporate the same checklist in `docs/agent-dispatch-prompts.md#evidence-limits-checklist`. Apply it to every workflow below, including the stub LLM custom probes and fixture regressions.

## UI reference comparison

A UI change is verified against the reference shots, not only against its own before picture. Surface to shots: `docs/design/references/README.md`; rules: `node scripts/design-rules-for.mjs <paths>` prints the rows the touched files need — `apps/web/DESIGN.md` plus the `## Rules` sections under `docs/design/surfaces/`; brief and coverage table: `.claude/skills/design-cairn/SKILL.md`.

1. List the states from the brief's component x state table. Produce each on the live stack; seed what the stack cannot reach (pending question, offline machine, quota, error, long content) with a fixture or seed data and label it fixture. Two states are required for every interactive control: slow network (delay each API reply about 400ms with a Playwright `page.route`) and rapid repeated input (press 50ms apart while the pointer drifts a few pixels); record that the final selection matches the last press and that nothing reordered.
2. Capture each state: `node .claude/skills/verify-cairn/scripts/vp.mjs capture </app/route> --name <state>` writes a 1440x732 dark screenshot into the evidence directory. Light theme and 390px need a Playwright context with `viewport` and `colorScheme`; the screenshot matrix is 1440 and 390, light and dark.
3. Put the reference beside ours, one image per state: `magick montage <reference> <ours> -tile 2x1 -geometry 1000x+8+8 <state>-compare.png`.
4. Write one sentence per pair: what matches, what is still worse than the reference. A pair with no sentence does not count.
5. Check the rule rows `node scripts/design-rules-for.mjs <paths>` prints for the touched files and report what you measured.

The session that built the screen reviews its own pairs. The evidence limits above still apply: fixture pairs say so, and a real-stack pair is required for the main state.

## Port and lane discipline (read first)

The in-repo port fleet: **8787** server / **5173** vite / **8399** e2e. Occupants are live processes of another lane (often the user's own dev stack) and **must not be killed**. This skill defaults to `8791 + (slot - 1)` and `5273 + (slot - 1)` (`8791`/`5273` on slot 1, `8792`/`5274` on slot 2); if launch finds them taken, override with `VERIFY_PORT` / `VERIFY_WEB_PORT`, never touch anyone else's port. Check occupancy: `lsof -iTCP:8791 -sTCP:LISTEN`. Shared ports and worktree rules: `docs/ops/worktrees-and-ports.md`.

**Worktree lane**: a worktree checkout carries its own copy of this skill.

- Start the stack with `VERIFY_REPO_ROOT=<worktree absolute path>` (the worktree needs `pnpm install`).
- Run the scripts **from the worktree path** (`node <worktree>/.claude/skills/verify-cairn/scripts/...`). Running the main checkout's scripts verifies new code with old probes and fails confusingly (for example a 30s timeout at `fill`, not a parse error).
- **Re-launch after changing code**: vite ignores `**/.claude/**` (`apps/web/vite.config.ts`), which covers worktrees under `.claude/worktrees/`, so edits made while the stack runs do not take effect and you would drive the old code.
- `VERIFY_REPO_ROOT` controls the stack and runtime state; evidence defaults to the main checkout so it survives worktree cleanup. Report the results; do not commit them.

Env contract (all scripts agree): `VERIFY_REPO_ROOT` / `VERIFY_RUN_DIR` (default `<repo>/.claude/verify-run/`) / `VERIFY_PORT` / `VERIFY_WEB_PORT` / `VERIFY_EVIDENCE_DIR`.

## Launch

```sh
node .claude/skills/verify-cairn/scripts/launch.mjs
# worktree lane: VERIFY_REPO_ROOT=<worktree> node <worktree>/.claude/skills/verify-cairn/scripts/launch.mjs
# other ports:   VERIFY_PORT=8792 VERIFY_WEB_PORT=5274 node <same as above>
```

- Run it as a background task (Claude Code `run_in_background`); it prints `verify stack ready` and then stays in the foreground as the stack's supervisor. Harnesses without background tasks: run `launch.mjs &`, the drives and `cleanup.mjs` in one command; the stack goes down when that shell exits.
- It starts the server (`pnpm exec tsx src/index.ts`, no watch) and vite dev (`--strictPort`) through `scripts/owned-process.mjs`. Stopping the task, ending the session, `vp.mjs cleanup`, or either process exiting takes the whole stack down.
- Before starting, `launch.mjs` waits for a shared live-stack slot (`CAIRN_LIVE_STACK_SLOTS`, default `max(1, floor(cores/4))`, under the shared `CAIRN_HEAVY_SLOTS_DIR`) and assigns slot-scoped ports (`8791 + (slot - 1)` / `5273 + (slot - 1)`); while queued it names each holder's lane, pid, command and age, and repeats that line every 30 s. A stack with no connection for `VERIFY_IDLE_TIMEOUT_MS` (default 5 min, `0` disables) stops itself, and a stack alive for `VERIFY_MAX_AGE_MS` (default 15 min, `0` disables) stops itself and removes `ports.json` so a forgotten stack cannot hold the slot.
- **Every launch clears the run directory, so every launch has a fresh DB** (first boot seeds one owner; no login needed).
- **Run `cleanup.mjs` before re-launching.** Launch refuses when ports are taken or a recorded stack is still alive; if an old stack still holds the ports, probes drive the old stack's DB and "fresh DB" assertions silently mix in the previous round.
- Readiness: `GET /api/user/me` 200 and `GET /app` 200; on timeout it prints both log tails and stops its own processes.
- Runtime state in `VERIFY_RUN_DIR`: `server.pid`, `web.pid`, `server.log`, `web.log`, `ports.json` (includes `supervisorPid`).
- Read logs with the Read tool, not Bash `tail` (not re-checked: a hook may block Bash commands that reference `*.log`).

## Doctor

```sh
node .claude/skills/verify-cairn/scripts/doctor.mjs   # read-only
```

Checks that the server and vite process groups are alive and that `/api/user/me` (named owner), `/api/teams`, `/api/projects` and web `/app` answer 200. Any FAIL exits 1; with no stack it says to launch first.

## Drive

Single entry: `node .claude/skills/verify-cairn/scripts/vp.mjs drive <feature> [case]`. List what exists with `node .claude/skills/verify-cairn/scripts/vp.mjs list [feature]`; the registry `vp-registry.json` is the source of cases, their status, preconditions and usage. Per-feature recipes and gotchas are in `features/`. The stack must be running.

Core probes (`scripts/drive.mjs <probe>`, each a real user journey with assertions, screenshot and API/SQLite truth, exit 1 on failure):

| probe | covered | key truth |
|---|---|---|
| `new-task` | board render + new-task full chain (creates a default project when none exists) | card on board + `GET /api/todos` row + SQLite `todo` row |
| `api-key` | `/app/api-keys` create a key | one-time cleartext `cairn_...` + masked row + SQLite stores the hash only; needs a fresh DB |
| `search` | sidebar search panel | result rows hit the created task |
| `theme` | theme persistence (`cairn-theme` localStorage) | light and dark both survive reload |
| `board` | workspace shell layout screenshot | registry status `stale` |

`vp.mjs` rules that change what you do:

- `launch`, `doctor`, `cleanup` pass through to the same-named scripts. `capture </app/route> [--name <label>] [--wait <ms>] [--video]` screenshots a page and records console errors and failed requests. `archive <ticket> --from <dir>` and `links <ticket>` are described under "Optional evidence archive".
- A case needing the stack runs doctor first and takes `VERIFY_PORT` / `VERIFY_WEB_PORT` from the run directory's `ports.json`; it refuses when the environment sets different ports.
- `--force` is required for a `stale` or `host-bound` case and for cases needing `real-llm`, `github` or `rewrites-evidence`. The refusal lists every reason at once.
- A `fresh-stack` case (for example `api-keys create`) runs only on a stack not yet driven since launch; otherwise `vp.mjs cleanup` then `vp.mjs launch`.
- An `own-stack` case (glass journeys, `github-emulator pr-watch`) starts its own stack and is refused while the run directory has one, even with `--force`; run `vp.mjs cleanup` first.
- Args after `--` replace only the same-named default args (the same option or probe name). A case whose usage has required positional args is refused without them.
- Without `VERIFY_EVIDENCE_DIR`, each drive opens `<main checkout>/.claude/verify-evidence/<local time>-<feature>-<case>/` (`-2`, `-3` appended on collision) and prints `vp: evidence <dir>`.
- Evidence output inside `docs/verify/` is refused (also for `capture`, and across every `git worktree list` entry); committed evidence is only ever added through `vp.mjs archive`.
- `--dry-run` prints the command without running it. New drivers are registered in `vp-registry.json` first and named by feature, not by ticket; `scripts/vp-registry-gate.mjs` (run by `scripts/vp-selftest.mjs` in CI) enforces this.

**Real daemon + stub LLM cases** (list them with `vp.mjs list`) need a stub LLM (`scripts/stub-llm-verify.mjs`), a seed (`scripts/setup-review-seed.mjs` or its variants) and a real daemon: `cd apps/daemon && pnpm exec tsx src/cli.ts start --foreground --server http://127.0.0.1:<VERIFY_PORT>`. **Write `--server` explicitly on the command line**: cleanup reclaims residual daemons by that marker, and the env-only form cannot be reclaimed safely. Other setup gotchas (proxy variables unset, `CAIRN_HOME` passthrough, `CAIRN_DEV_SERVER_PORT`) are in `features/stop-button.md` (Gotchas; not re-checked).

GitHub-facing PR evidence: `features/github-emulator.md` and `vp.mjs drive github-emulator pr-watch` (real PR-watch poller over HTTP, no GitHub credentials).

## Evidence

Evidence directory = `VERIFY_EVIDENCE_DIR`, or the default above for `vp.mjs drive`; scripts run directly use their own default, mostly under the **main checkout** `.claude/verify-evidence/<timestamp>-<probe>/`. It holds `result.json` (probe, per-check ok/label, stack coordinates) and screenshots. **cleanup does not delete evidence.** Proof standard: before and after screenshots, every `result.json` check ok, and API/DB truth fields, not just the final screen. Evidence goes to the main checkout rather than `VERIFY_REPO_ROOT` because a worktree's evidence is lost when the worktree is deleted.

## Optional evidence archive

Link or describe evidence where you report. Do not commit it under `docs/verify/` on a branch; `main` carries no such directory. Older `docs/verify/<ticket>/...` paths named in feature recipes were removed from `main` on 2026-11-12; `docs/README.md` (Per-ticket artifacts) says how to read them from history.

Embed any supplied image links and check that they return HTTP 200. Keep the probe name, check count, stack coordinates, provider mode and verification limits alongside the result.

When a repository archive is useful, the add-only archive command never overwrites existing files:

```sh
VERIFY_REPO_ROOT=<checkout> node .claude/skills/verify-cairn/scripts/vp.mjs archive <ticket> --from <evidence directory>
node .claude/skills/verify-cairn/scripts/vp.mjs links <ticket>   # SHA-pinned raw links, after the commit is pushed
```

### Acceptance signature

Reconcile the issue's Acceptance items with the delivered behavior:

1. Read the issue body with `gh issue view <ticket> --json body`.
2. Check only delivered items supported by actual results. Record the commit, merge date, results and verification limits; link evidence when available.
3. Write back with `gh issue edit <ticket> --body-file <tmpfile>`.

Leave undelivered items unchecked and record the gap.

## Mechanism takes effect acceptance: artifact criteria (hard rule)

Mechanism-class changes (CSS/animation, on-disk/wire format, schema, config passthrough, service traffic) are accepted on the **compiled or runtime artifact**, not on source reading. Every "X takes effect" claim must answer "where do I take X's artifact"; not obtainable = not accepted. The truth trio (screenshot + API JSON + SQLite row) covers whether functional behavior is correct; this table covers whether the mechanism connected.

| Claim | Where the artifact is taken |
|---|---|
| animation/CSS class took effect | compiled CSS: `pnpm --filter @cairn/web build`, then grep `apps/web/dist/assets/*.css` for the rule; at runtime, a browser probe reading `getAnimations()` playState |
| shim/forwarding service has traffic | the service's own file log (for example `/tmp/pi-shim*.log`), not journal/systemd; see `docs/research/machine-execution-plane.md` |
| X's consumers are zero, deletable or still alive | grep the current tree on the day you execute (apps, packages, integration, e2e), and enumerate dynamic concatenation points; an audit-time list is only a snapshot |
| on-disk/wire format changed, all layers compatible | each layer's actual readers and a run of each layer: unit pins (`apps/daemon/test/`) and integration pins (`integration/test/`, for example the `daemon.log` readers) are independent; migrate all harnesses together and run `VITEST_PROJECT_SET=integration pnpm test` locally; `vitest related` cannot select this coupling |
| shared schema change is fine | run `packages/shared/test/snapshot.test.ts` locally; it pins the zod schema's JSON projection; update intentional changes with `-u` and review the diff |
| field Y usable as criterion X | Y's runtime value on the target form: live-stack `curl /api/...` JSON plus read-only SQLite rows (for example manual projects, where a server-side projection can be always empty) |

The compiled-CSS and shared-schema rows are partly automated (CI runs the snapshot suite); the rest depend on runtime or execution-day artifacts and rely on this table.

## Cleanup

```sh
node .claude/skills/verify-cairn/scripts/cleanup.mjs
```

SIGTERMs the supervisor recorded in `ports.json`, then, for stacks started without a supervisor, kills the pid-file groups (SIGTERM, 6s grace, SIGKILL) after checking the command line contains `tsx`, `vite` or `pnpm`; deletes `VERIFY_RUN_DIR` (scratch home and logs); leaves evidence. It also reclaims residual daemons that launch or probe failures left outside the pid files, matched by the dual marker `cli.ts start` + this stack's `--server http://127.0.0.1:<VERIFY_PORT>`; with no port pin it refuses to sweep and says so. The user's dev stack (8787/5173) and the e2e lane are unaffected.

**Hard rule: only kill processes recorded in your own pid files or matched by your own port pin; never kill by process-name shape** (`cli.ts start`, `tsx`, `ps | grep | kill`). The user's main-checkout dev daemon has exactly that shape (`tsx src/cli.ts start -f`); a lane that killed by it once took the user's dev daemon down with no trace in the logs.

## Helpers

| Script | Role |
|---|---|
| `scripts/vp.mjs` | unified entry: launch, doctor, cleanup, list, drive, capture, archive, links |
| `scripts/launch.mjs` | start the isolated stack and supervise it until cleanup or owner death |
| `scripts/doctor.mjs` | read-only health check |
| `scripts/drive.mjs` | core Playwright probes (above) |
| `scripts/cleanup.mjs` | reclaim the stack, keep evidence |

## When not to use this skill

- Visual regression and fixture-face regression (`?scenario=`, `E2E_PORT` 8399) go through `apps/web` playwright e2e; the visual specs' computed-style assertions pin geometry. During development run only the relevant specs.
- A quick API check: `curl http://127.0.0.1:<VERIFY_PORT>/api/...`, no browser needed.
