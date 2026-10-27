---
name: verify-cairn
description: Behavior verification for cairn - spin up an isolated live stack (server VERIFY_PORT 8791 + vite dev VERIFY_WEB_PORT 5273, independent CAIRN_HOME scratch), Playwright walks real user journeys (new task / create API key / search / theme), evidence (screenshots + API JSON + SQLite rows) archived into docs/verify/<ticket>/ committed with the PR and referenced in the body by a commit-SHA permalink. Use when you must prove a feature really runs after a change and need reviewable evidence; fixture-surface regression goes through apps/web e2e (including the visual specs' geometric assertions), not this skill.
---

# verify-cairn

cairn = a todos.dev replica (React/vite web + Hono REST/SSE/SQLite server). This skill spins up an **isolated instance** (independent ports + independent data root, never touching the user's real data `~/.cairn` or the live dev stacks on 8787/5173), walks real user journeys with the repo's own Playwright chromium, produces evidence, then cleans up cleanly. Scripts all live under `scripts/`; runtime state and runtime evidence live under `.claude/` (gitignored); at wrap-up, evidence is archived into `docs/verify/<ticket>/` and enters the repo with the PR (see "evidence archive discipline").

Control Glass entry (the clicks are in the scripts; this file does not restate those five journeys): `.cursor/skills/verify-cairn/SKILL.md`. The journey contracts are in `features/glass-journeys.md` (this directory's `features/` stays the canonical source; the cursor side is a link to the same directory). One-command re-run: `node .cursor/skills/verify-cairn/scripts/glass.mjs`.

**Unified entry `scripts/vp.mjs` (#1402)**: `launch` / `doctor` / `cleanup` pass straight to the same-named scripts below; `list [feature]` lists cases; `drive <feature> [case] [--dry-run] [-- <script args>]` dispatches per `vp-registry.json` (a stack-requiring case first auto-runs doctor; a `stale` / `host-bound` case, or one requiring `real-llm` / `github` / `rewrites-evidence`, needs `--force` (on refusal it lists all reasons at once: status and every `--force`-requiring precondition; with `--force` it prints the same list again before running); a `fresh-stack` case (whose registry usage says it needs a fresh DB, e.g. `api-keys/create`, `machine-stale-sweep/stale-sweep`) only runs on a stack that has not yet been driven since launch: vp.mjs records every stack-requiring drive into the run directory's `vp-drives.txt` (recorded after doctor passes and before the probe starts; launch clears the run directory, which zeroes it), the record then becomes a `--force` reason, hinting `vp.mjs cleanup` then `vp.mjs launch` again; an `own-stack` case (glass journeys, which start and stop their own stack) is refused outright when the run directory has a stack (`ports.json`), `--force` also refuses, run `vp.mjs cleanup` first; a case whose `VERIFY_EVIDENCE_DIR` (or the probe output option given after `--`) lands inside `docs/verify/` is refused before running (exit 2, `--dry-run` also refuses; the caller's cwd, `VERIFY_REPO_ROOT`, and every `git worktree list` entry of the repo vp.mjs lives in all count, so calling the main checkout's vp.mjs from a worktree also protects the worktree's already-archived evidence), committed evidence is only ever added via `vp.mjs archive`, and `capture` refuses the same; args after `--` only replace the same-named ones in the default args (same option before `=`, or same probe name / journey name), the rest of the defaults kept (the post-fix switch `--expect=...` does not get dropped because other options were added); a case with required positional args in its usage (registry `needsArgs`) is refused when given none, options alone do not count; an evidence output path given after `--` is resolved against the caller's directory; the probe receives the `VERIFY_RUN_DIR` doctor already checked; a stack-requiring case takes `VERIFY_PORT` / `VERIFY_WEB_PORT` from the stack's `ports.json` and passes them to the probe, refusing if the environment sets different ports; a missing script in the registry or a tsx case missing `cwd` errors before doctor, `--dry-run` errors too; a `runner: tsx` case runs tsx in the package directory named by the registry `cwd`, the repo root has no tsx, environment evidence and run directory are resolved to absolute paths first; without `VERIFY_EVIDENCE_DIR` each drive, after doctor passes, opens its **main checkout** `.claude/verify-evidence/<local time>-<feature>-<case>/` (running vp.mjs from a worktree also lands in the main checkout, not deleted with the worktree; if the same-named directory exists it appends `-2`, `-3`) and prints `vp: evidence <dir>`, so scripts do not fall back to their own defaults (some defaults write `docs/verify/<old ticket>/` or scripts/, which would rewrite committed evidence); probes that ignore this variable carry `evidence`:`{flag}` in the registry and receive the directory via that arg (glass.mjs's `--out`; when the caller gives this arg after `--` vp.mjs uses it and does not open another directory), `{writes}` writes to its registered path and vp.mjs opens no directory for it, `{env}` receives the directory via another registered variable; a node case runs at the repo root; `--dry-run` only prints the command that would run); `capture </app/path>` screenshots and records console errors and failed requests (writes into a new `capture-<label>/` when `VERIFY_EVIDENCE_DIR` is set, appending `-2` when the same exists; writes result.json even when the browser cannot start or the screenshot fails); `archive <ticket>` copies the named evidence into `docs/verify/<ticket>/` (add-only); self-test `scripts/vp-selftest.mjs` (one of which runs the registry gate `scripts/vp-registry-gate.mjs`: unregistered files under scripts/, newly added `drive-<number>` scripts, scripts or recipes missing from the registry, unknown status or need, a case writing into `docs/verify` without the `rewrites-evidence` flag, a feature map missing this feature's `vp.mjs drive` line or pointing at a nonexistent case, all red in CI); `links <ticket>` prints SHA-pinned raw links after the commit is pushed. New drivers register in the registry first, scripts named by feature, no new `drive-<ticket>.mjs` (the registry gate only allows the existing 28 that are still current or host-bound; a stale ticket-named probe is archived at `docs/verify/<ticket>/<script>` and the registry points there). The direct-run commands for each script below remain valid.

Change history: `changelog/` one file per ticket (`<date>-<ticket>.md`; the old "Last updated:" single-line chain retired per #1039 - every lane prepended an entry to the chain head, two lanes were bound to collide on the same hunk). A lane recording a new entry = **create a new file and commit it with the PR**, do not change this line, do not edit old entry files; the convention is in `changelog/README.md`. Order follows `git log --oneline -- .claude/skills/verify-cairn/`.

## Evidence limits checklist

Apply this checklist before reporting verification or handing off a delivery. For each acceptance claim, record the command, tested commit, app surface (fixture or live), provider mode (stub, real, or not exercised), artifact path, result and remaining limits. Mark an unavailable check as unverified rather than widening a narrower result.

- Fixture screenshots cannot establish real-app behavior. Keep focused fixture UI and visual regression tests; label them as fixture evidence. Verify claims about the real app on an isolated live stack without `?scenario=`, using the relevant API, database or runtime observations alongside screenshots.
- Stub-only runs cannot establish real-provider behavior. Keep deterministic stub regressions, including real-daemon protocol and orchestration checks; name the stubbed boundary and limit the claim to the exercised layers. A real-provider claim requires a real-provider run with recorded provider mode and runtime evidence; if credentials or access are unavailable, report that claim as unverified.
- Local-only evidence cannot support a delivered verification claim. Commit supporting artifacts under `docs/verify/<issue>/` on the delivery branch and reference them from the PR body with commit-SHA-pinned raw links. A local run directory, external upload or another repository's or issue's archive is not that delivery's evidence. Preserve ordinary reference links as references; JSON, logs and Markdown evidence need readable links, not image embedding.
- Mechanism claims require compiled or runtime evidence of the claimed effect, such as compiled CSS, observed animation state, actual wire payloads, runtime logs or schema snapshots. Source, configuration and installed dependencies alone do not establish that the mechanism took effect. Record the artifact and the assertion it supports.
- Separate automated checks from review. The current `scripts/pr-evidence-gate.py` checks nonempty Verified/Upstream sections and embedding plus HTTP 200 for recognized image links. It does not establish evidence sufficiency, live-app origin, real-provider execution or correct repository/issue archive provenance. Reviewers must inspect these limits and compare claims with artifacts. Robust fixture-URL parsing and archive provenance enforcement are planned separately in #1982 and #1983; #1810 remains incomplete after this documentation change. Do not claim the gate detects stub-only runs without machine-readable provenance. Future automation needs explicit provenance and negative controls, not inference from a screenshot or a passing HTTP request.

The implementer templates incorporate the same checklist in `docs/agent-dispatch-prompts.md#evidence-limits-checklist`. Apply it to every workflow below, including the stub LLM custom probes and fixture regressions.

## Fact base (interrogated 2026-09-25; after the feature faces evolve, run `/maintain-verification-skill` to correct)

| Dimension | Fact |
|---|---|
| Surface | web UI (`apps/web`, vite) first; HTTP API (`apps/server`, Hono REST+SSE+SQLite). daemon optional, UI verification does not need it. |
| Run | `pnpm dev:server` (default 8787, first boot auto-creates the DB + seeds a single user **Owner**) + `pnpm dev:web` (vite dev 5173, proxy `/api`, `/git` to the server). No auth: seeded = auto-logged-in, browser opens usable directly. Production form = root `pnpm start` (build web to server same-origin serving `apps/web/dist`). |
| Drive | Playwright (`@playwright/test` root devDep, chromium installed). live mode = URL **without** `?scenario=` (with it = the fixture face, e2e-only). |
| Observe | screenshots (1440x732, same convention as e2e); HTTP JSON (`GET /api/auth/session`, `/api/todos`, `/api/teams`...); SQLite rows (`<CAIRN_HOME>/server/server.db`, better-sqlite3 read-only); server logs (`cairn-server online` line). |
| Isolate | three axes: `VERIFY_PORT` (server, default 8791) / `VERIFY_WEB_PORT` (vite, default 5273) / `CAIRN_HOME` (scratch). vite dev does not write `dist/`, no collision with e2e's dist. |

## Port and lane discipline (read first)

The in-repo port fleet: **8787** server / **5173** vite / **8399** e2e. Occupants are live processes of another lane (often including the user's own dev stack), **must not be killed**. This skill defaults to 8791 + 5273; if launch finds them taken, change ports (env override `VERIFY_PORT` / `VERIFY_WEB_PORT`), never touch anyone else's port. Check occupancy: `lsof -iTCP:8791 -sTCP:LISTEN`.

**worktree lane**: since 2026-09-28 `.claude/skills/verify-cairn/` is committed in the repo (a .gitignore nested exception), **a worktree checkout carries this skill's full copy**. Run method: `VERIFY_REPO_ROOT=<worktree absolute path>` to start the stack (the worktree must already have `pnpm install`), and **must run the scripts themselves from the worktree path** (`node <worktree>/.claude/skills/verify-cairn/scripts/...`) - running from the main-checkout path uses the main checkout's old probe scripts to verify the lane's new code, the symptom is extremely confusing (the old script times out 30s at fill, not a parse error; #386 real case burned 5 rounds to locate). **Must re-launch after changing code**: the worktree is under `.claude/worktrees/`, and vite's `**/.claude/**` watch-ignore covers the whole worktree, so changing code while the stack is running does not take effect (measured, in project memory), and what gets driven is the old code.

**lane wrap-up must-do** (evidence disappearing with the worktree is this skill's biggest pit, see "evidence archive discipline"): `VERIFY_REPO_ROOT` only affects the stack and runtime state, evidence defaults to the main checkout; after running, still archive the evidence into `docs/verify/<ticket>/` on a checkout of the PR branch via `vp.mjs archive <ticket> --from <evidence dir>` (copy-only, target already exists = refuse; do not hand `cp`) and commit + check the issue acceptance boxes (see "evidence archive discipline"), otherwise once the lane wraps up and the runner is reclaimed, the verification claim is unverifiable.

## Launch

```sh
# run from the repo root (the script defaults VERIFY_REPO_ROOT = go up 4 levels from its own location = repo root)
node .claude/skills/verify-cairn/scripts/launch.mjs
# worktree lane: VERIFY_REPO_ROOT=<worktree> node <same as above>
# change ports: VERIFY_PORT=8792 VERIFY_WEB_PORT=5274 node <same as above>
```

- Starts two detached process groups: `pnpm exec tsx src/index.ts` (server, no-watch form, equivalent to `dev:server` minus watch) + `node node_modules/vite/bin/vite.js --strictPort` (web dev, proxy pointing at our server).
- **Every launch clears the run directory = every time a fresh DB** (first boot seeds a single user, no login state needed).
- **Must `cleanup.mjs` before re-launching**: the old stack's processes still hold `VERIFY_PORT`/`VERIFY_WEB_PORT`, a new launch does not kill them - the readiness probe hits the **old** stack's listener, the newly started processes cannot bind the ports, and the probe drives the previous round's old DB (symptom: the "fresh DB" assertions silently mix in the previous round's state, no error at all; #950 measured it: the previous round's saved charter made this round's empty-state checks all wrong).
- Readiness judgment: `GET /api/auth/session` 200 (server) + `GET /app` 200 (vite SPA fallback), poll until connected; on timeout auto-print both log tails then kill its own started processes.
- **Read logs with the Read tool, not Bash `tail`**: this machine's scout-block hook baseline mode blocks `*.log` (any Bash command referencing any .log path gets BLOCKED); launch/the scripts themselves reading via fs are unaffected.
- Runtime state lands in `VERIFY_RUN_DIR` (default `<repo>/.claude/verify-run/`): `server.pid`, `web.pid`, `server.log`, `web.log`, `ports.json`. A failed launch kills its own started processes, leaves no orphans.

## Doctor

```sh
node .../scripts/doctor.mjs   # read-only, zero write operations
```

Checks: pid group alive to `GET /api/auth/session` 200 and `displayName === "Owner"` to `GET /api/teams` 200 to `GET /api/projects` 200 to web `GET /app` 200. Any FAIL exit code 1. When the stack is not up, hint to run launch first.

## Drive

```sh
node .../scripts/drive.mjs <probe>    # probe in board | new-task | api-key | search | theme
```

The stack must be running (launch first). Each probe = a real user journey (click buttons / fill forms, no internal setters), assertion + screenshot + API/SQLite dual truth, failure exit code 1. Probe details, selectors, and gotchas are in `features/` (the map is the canonical source, do not just verify the convenient entry). Mapped:

| probe | covered | key truth |
|---|---|---|
| `new-task` | board render + new-task full chain (auto-creates `默认项目` when no project) | card on board + `GET /api/todos` row + SQLite `todo` table row |
| `api-key` | `/app/api-keys` create a key | one-time cleartext `cairn_...` + masked row + SQLite stores keyHash not cleartext |
| `search` | sidebar search panel | result rows hit the created task |
| `theme` | theme persistence (`cairn-theme` localStorage) | light/dark both reload and take effect |
| `board` | workspace shell (4 columns since #351) | layout screenshot |

Note: the `api-key` probe assumes a fresh DB (the create button only shows in the empty state) - re-launch before re-verifying.

**Custom probes** (each an independent script, recipe and prerequisites in the corresponding feature file. The full list = the scripts/ directory; the table below is the full-stack chain of the **real daemon + stub LLM gated wheel**):

```sh
node .../scripts/drive-stop.mjs <todoId>                          # stop-button full chain (stop-button.md, #308; includes the #318 start dialog)
node .../scripts/drive-review.mjs <todoId>                        # AI review initiate + enqueue (review-modal.md, #312)
REVIEW_MACHINE_TOKEN=<t> node .../scripts/drive-review-blocking.mjs <todoId> <agentId>  # blocking auto-revise loop (#330/#332)
node .../scripts/drive-review-700.mjs <todoA> <todoB>             # verdict extraction true chain (#700; stub-review-700 + setup-review-700-seed prerequisites, review-700.md)
node .../scripts/drive-failed-review-restore.mjs                 # failed to review recovery dual-exit full chain (#702; hosted form, the machine face walks the true machine wire via the probe, self-contained seed)
node docs/verify/920/drive-920-skills-manifest.mjs --phase=wire|daemon-success|daemon-incremental|daemon-fail  # skill dispatch manifest + on-demand pull (#920; the wire phase has no daemon dependency, daemon-* phases need stub LLM + real daemon; recipe and reading = docs/verify/920/README.md)
node docs/verify/929-930/drive-929-930.mjs   # command-gate tool_call seam + pi native MCP bridge double-ticket two-way evidence (#929/#930; self-spawns stub LLM + stdio MCP fixture + real daemon and self-reaps; recipe and reading = docs/verify/929-930/README.md)
node docs/verify/918/drive-918-skill-facts.mjs   # skill facts live row + detail summary (#918; includes the deny-block face and the control group; self-spawns stub LLM x2 + real daemon and self-reaps; recipe and reading = docs/verify/918/README.md)
node docs/verify/919/drive-919-skills-routing.mjs --phase=behavior|deny-ui  # skill routing behavior acceptance (#919; behavior = real-model leg - claude-code runtime + local claude login state, the ticket face has zero skill words and watches the lane hit on its own; deny-ui = inline-script stub leg - the deny-event UI visible face + LLM input-face directory assertion; recipe and reading = docs/verify/919/README.md)
node docs/verify/1169/drive-1169-skills-split.mjs --phase=api|behavior  # agent skill split fields (#1169; api = pure live stack zero daemon - REST read/write face two states / claim payload null vs array / manifest selection=all; behavior = real-model leg - a new agent without skills reads SKILL.md with zero deny; recipe and reading = docs/verify/1169/README.md)
node docs/verify/1171/drive-1171-native-plugin.mjs --phase=wire|behavior  # team-skill native plugin channel (#1171; wire = fake CLI captures argv zero LLM four legs 32 checks - delivery face / version gate / [] empty manifest / null all; behavior = real-model leg 10 checks - transcript Skill tool call naming the plugin-qualified name + pre-seeded repo skill byte-preserved; daemon self-spawned self-reaped; recipe and reading = docs/verify/1171/README.md)
node docs/verify/925/drive-925-pi-policy.mjs  # pi session policy evidence (#925/#927, spec 26; pure HTTP+fs+SQLite no browser face - trust deny four faces + policy announcement line + cost DB worked example + prompt_cache_retention request face; self-spawns stub LLM + real daemon and self-reaps; recipe and reading = docs/verify/925/README.md)
node docs/verify/904/drive-904-plan-chain.mjs   # plan.md storage channel full chain (#904; withPlan build to plan table row to confirm card / right-pane plan face has something; three legs: hosted forward + bare-directory #703 forward + negative control "missing artifact must red"; stub x3 + real daemon self-spawned self-reaped; recipe and reading = docs/verify/904/README.md)
node docs/verify/1025/drive-1025-plan-first-round.mjs   # first-round plan contract injection (#1025; the real first-round request body received from the stub asserts the contract combined string + plan v1 first-round DB with zero backfill steps + negative control backfill-round fallback; stub x2 + real daemon self-reaped; recipe and reading = docs/verify/1025/README.md)
node docs/verify/1213/drive-1213-dual-source.mjs  # dual source: github project localPath same-machine acceleration (#1213/ADR 0017; server unbinding + settings-page field real user path + daemon x2 source selection: local source / ineligible fallback to GitHub each one log line and git artifact; true remote = public repo octocat/Hello-World; recipe and reading = docs/verify/1213/README.md)
node docs/verify/1210/drive-1210-local-unreachable.mjs  # local-form execution face fails loud (#1210 C backstop; mv the repo directory away to step explicit failure errorMessage naming machine/path/reason/fix + zero clone attempts + detail-page failure card screenshot; mv back to materialization normal zero drift; stub LLM + real daemon x1 self-reaped; recipe and reading = docs/verify/1210/README.md)
node docs/verify/1250/drive-1250-persona-verify.mjs  # persona roster + verify step + three-perspective fan-out + split_todo (#1250/ADR 0018; four phases: seed six personas / verify step enqueue-claim-verdict / fan-out browser real click three steps each carrying a persona / split wave + parent auto-close; fake machine wire zero daemon zero LLM; recipe and reading = docs/verify/1250/README.md)
node .../scripts/drive-1242-project-identity.mjs  # project identity mutable face (#1242; six legs: five-field PATCH silent-family death judgment + browser rename/description/convert card + in-flight build 409 toast + note landing on board + claim payload before/after shape comparison; fake machine wire zero daemon zero LLM; real api.github.com anonymous ladder checks reachability; recipe and reading = docs/verify/1242/README.md)
cd apps/daemon && corepack pnpm exec tsx .../scripts/drive-926-convergence.mts  # retry and settling timing made explicit (#926; .mts runs the daemon package's tsx, no web/server stack - directly imports daemon source + pi package; three phases: true pi SettingsManager reads back explicit retry config, true pi AgentSession x stub LLM captures the raw event order agent_end to agent_settled and done only lands at settled, mapPiSessionEvent comparison; self-starts stub and self-reaps, recipe and reading = docs/verify/926/README.md)
```

**Pure live-stack probes** (no daemon dependency, run directly after launch; recipe in the corresponding feature file):

```sh
REVIEW_MACHINE_TOKEN=<t> node .../scripts/drive-review-reject.mjs <todoId>  # review gate human rejection (#701, review-reject.md; prerequisite setup-review-seed, no daemon/LLM dependency)
node .../scripts/drive-avatars.mjs             # dicebear avatars (#387, avatars.md)
node .../scripts/drive-hotkeys.mjs             # C/Space hotkeys (#389, hotkeys.md)
node .../scripts/drive-newtask-key.mjs         # new-task hotkey positive-negative pairs (XMON-41, hotkeys.md)
node .../scripts/drive-chief-model-select.mjs  # chief compression-model selector (#358; the selector family)
node .../scripts/drive-agent-identity.mjs      # agent identity clickable into settings (#741; --expect=old takes the before baseline)
node .../scripts/drive-chief-segments.mjs      # segment-row sealing (#955/ADR 0011; pushes frames per the post-seal true wire order + drawer in-flight state; three probe pits in docs/verify/955/README.md)
node docs/verify/1033/drive-1033-avatar.mjs         # chief thinking-row/tool-row avatar geometry (#1033; real Lorelei-shape stub + same-frame geometry measurement; --expect=old takes the before baseline; evidence docs/verify/1033/)
node docs/verify/1034/drive-1034-thinking-truncate.mjs --expect=new|old  # thinking-line width truncation two-way evidence (#1034; chief drawer + detail conversation two faces geometry/computed measured, zero daemon zero LLM; --expect=old drives the origin/main one-off worktree baseline stack to reproduce the defect; recipe and reading = docs/verify/1034/README.md)
node .../scripts/drive-1308-thinking-delta.mjs --expect=new|old  # thinking body into the conversation stream (#1308; fake machine wire pushes activity+thinking_delta, zero daemon zero LLM; --expect=old has no body on the stream, --expect=new the detail-page Think row shows the marker and only one remains settled; recipe = docs/verify/1308/README.md)
node docs/verify/1065/drive-1065-zombie-claim.mjs   # zombie claim minimal scenario (#1065; dead machine = child process claim long-poll SIGKILLed, live machine = the probe's own process claim; two-way asserts the dead machine zero claims + the live machine's wake path claims it, zero daemon zero LLM zero browser; before-stack cross-check in the recipe; recipe and reading = docs/verify/1065/README.md)
node docs/verify/902/drive-902-gate-actor.mjs --expect=new|old  # gate-actor audit three-ticket joint (#902/#900/#901; true machine wire pushes to confirm/review + REST/chief relay passes the gate + browser real drag recording to GIF; --expect=old drives the origin/main baseline stack for before; evidence docs/verify/900/)
node docs/verify/903/drive-903-dispatch-judgment.mjs  # chief dispatch judgment (#903/ADR 0014; settings-slot dead state + per-dispatch judgment + dispatchReason receipt three legs, fake machine claims the chief-round step relay run_builds three shapes cross-checked against SQLite, zero daemon zero LLM; recipe and gotcha = features/chief-dispatch-judgment.md)
node docs/verify/1208/drive-1208-machine-pin.mjs  # machine-pin dispatch visibility (#1208; todo-pin dispatch hard constraint wire truth + run_builds explicit re-dispatch detail machine row `（任务钉选 {machine}）` tail note + obey/auto dual control, --expect=old drives the origin/main baseline; zero daemon zero LLM; recipe and gotcha = changelog/2026-10-11-1208.md)
node docs/verify/1033/drive-1033-avatar.mjs         # chief thinking-row/tool-row avatar geometry (#1033; real Lorelei-shape stub + same-frame geometry measurement; --expect=old takes the before baseline; evidence docs/verify/1033/)
node docs/verify/952/drive-952-finale.mjs          # straggler closure (#952; dialog-shell carriers / form-family geometry / detail-memory-permission truth chain / retirement audit / dual-theme contrast)
node .../scripts/drive-1008-overlay-registry.mjs  # overlay+overlays domain registry-family split (#1008; Popover/DropdownMenu/Dialog/AlertDialog/Tooltip+Kbd shell-family artifacts + outside-click penetration ruling face; recipe and reading = docs/verify/1008/README.md)
node .../scripts/drive-1035-zoom-fit.mjs --expect=new|old  # zoom-fit board responsiveness (#1035; live REST seed + step the viewport measuring .board-scroller geometry + Cmd+J dock / Escape live flip; --expect=old drives the origin/main one-off worktree stack (8793/5275) for the before baseline; recipe and bound table = docs/verify/1035/README.md)
node .../scripts/drive-detail-pane.mjs         # detail page 3-pane (#366, detail-right-pane.md)
node .../scripts/drive-mcp.mjs                 # MCP read-only local config face (spec 13/#368, mcp-servers.md)
node .../scripts/drive-project-new-form.mjs    # new-project form (spec 12/#360, project-new-form.md)
node .../scripts/probe-github-oauth.mjs        # GitHub auth + repo picker (spec 12/#361, github-oauth-picker.md)
node .../scripts/probe-local-repos.mjs         # local project API three states (spec 12/#359, local-repo-api.md)
node .../scripts/drive-1030-local-files.mjs    # local project Files tab opening read face + unreachable degradation (#1030, project-files-local.md; three phases: local readable / hosted control / deleted-repo degradation)
node .../scripts/drive-1102-commit-detail.mjs  # history-row commit detail face (#1102, project-commit-detail.md; three phases: hosted five criteria + browser click row switch / local root commit all-new / deleted-repo degradation)
node .../scripts/drive-1007-pages.mjs           # pages-domain live face (#1007): schedules registry Dialog real user path + settings-page Card structural face
node .../scripts/drive-1010-select.mjs          # select.tsx handwritten component retirement to registry compound select (#1010): schedules time/minute Select real user path + registry structural artifacts (Popup role=presentation / inner Select.List role=listbox no aria-label / trigger button aria-controls to listbox) + dual-theme incremental-face contrast measurement; live 22/22 PASS, evidence docs/verify/1010/
node .../scripts/drive-attachments.mjs / drive-branch-sync.mjs / drive-failed-send.mjs / drive-mentions.mjs / drive-tags.mjs  # M7 six-feature family (each feature file)
```

Prerequisites: stub LLM (`scripts/stub-llm-verify.mjs`, gated delay wheel) + seed (`scripts/setup-review-seed.mjs` or its variant) + real daemon (`apps/daemon` `pnpm exec tsx src/cli.ts start --foreground --server http://127.0.0.1:<VERIFY_PORT>`, **`--server` must be written explicitly into the command line** - cleanup's residual reclamation relies on port pinning, the env-only form has no command-line marker and cannot be safely reclaimed; the gate is in stop-button.md Gotchas: 6 proxy all unset / CAIRN_HOME export passthrough / vite CAIRN_DEV_SERVER_PORT).

**spec 11 probes** (feature map ahead of implementation, A12/#354; implementation tickets #355/#356/#357/#358 all landed and merged, **this group should now all be green** - red = regression; run order: tabs (needs a fresh DB, pi empty-state assertion) to picker (e2e creates the provider) to machines (idempotent); the three scripts' fallback page `docs/spec/11-model-service-and-machine-localization.md` is the clause canonical source):

```sh
node .../scripts/drive-providers-tabs.mjs    # providers runtime tabs (providers-tabs.md, spec 11 A1-A4/A7)
node .../scripts/drive-provider-picker.mjs   # add-provider picker (provider-picker.md, spec 11 A5/A6)
node .../scripts/drive-machines-local.mjs    # machines local row + switches (machines-local-row.md, spec 11 A8/A9)
```

## Evidence

Evidence directory = `VERIFY_EVIDENCE_DIR` (when driving via `vp.mjs drive`, default is the main checkout's `.claude/verify-evidence/<time>-<feature>-<case>/`; when running a script directly, the script's own default, mostly the **main checkout** `<main checkout>/.claude/verify-evidence/<timestamp>-<probe>/`), containing `result.json` (probe, per-check ok/label, stack coordinates) + screenshot PNGs. **cleanup does not delete evidence**; the proof standard = screenshots showing before/after states + result.json checks all ok + API/DB truth fields (not just the final screen).

Evidence defaults to the **main checkout** rather than `VERIFY_REPO_ROOT` - a lane's stack runs in a worktree, and evidence landing in the worktree would be permanently lost when the worktree is deleted. This pit was measured in M7: the #310/#319 PR bodies claimed verify-cairn ran, but after merge the main checkout had no evidence directory at all, the verification claim unverifiable (see #345).

## Evidence archive discipline (hard rule)

`.claude/verify-evidence/` is a gitignored local directory, **it can never enter a PR**. A delivery carrying a verify claim must archive the evidence (screenshots + API JSON + SQLite rows) into `docs/verify/<ticket>/` (`<ticket>` = issue number, currently `XMON-<n>` like XMON-104; historical pure numbers like 319 likewise) and commit it with the delivery PR. Archive via `vp.mjs archive` (#1402; the old archive.mjs deleted by XMON-63): it only copies, target already exists = refuse (add-only), the source must be named - `--from <dir>`, `VERIFY_EVIDENCE_DIR`, or explicit `--latest <n>` (the newest few under the shared evidence root, possibly another lane's). Do not use `cp -R` anymore: it silently merges and overwrites same-named directories.

```sh
VERIFY_REPO_ROOT=<PR branch checkout> node .claude/skills/verify-cairn/scripts/vp.mjs archive <ticket> --from <main checkout>/.claude/verify-evidence/<timestamp>-<probe>
# in that checkout: git add docs/verify/<ticket> && git commit (with the delivery PR, do not open a separate PR just for archiving evidence)
# after pushing: vp.mjs links <ticket> prints the SHA-pinned raw links
```

- **A verify claim without evidence archived in the repo with the PR is treated as unverified**, the receiver cannot re-check it.
- **PR body inline screenshots** use the commit-SHA permalink: `![caption](https://raw.githubusercontent.com/xiechimon/cairn/<head SHA>/docs/verify/<ticket>/<file>.png)` - this repo is public, raw is anonymously readable (#587/#589 same shape); must pin the commit SHA, a branch name drifts with later pushes. GitHub has no public attachment-upload API (the `user-attachments` links from web drag-drop need a browser session); the agent flow is always "evidence into the repo + raw permalink inline".

- **If the repo were private**, `raw.githubusercontent.com` always 404s (the CDN does not forward auth), use the `https://github.com/<owner>/<repo>/raw/<SHA>/<path>` permalink instead (viewable to logged-in viewers with repo access).
- The PR body writes the probe name + check pass count (align with `result.json`'s ok count, do not write approximations) + stack coordinates, so the receiver can re-check against the in-repo evidence; multiple evidence groups add a `docs/verify/<ticket>/README.md` index (#587 shape).
- **Never write "evidence at local path"**: the runner's `.claude/verify-evidence/` is unreachable to readers; the in-repo archive path + the PR body's raw link is the only credential.
- Evidence is 200-300KB per run (mostly screenshots), acceptable volume; the truth trio (screenshot + API JSON + SQLite row) stays, archiving only changes the disk location not the convention.

### Acceptance signature (hard rule, wrap up the same day as archiving)

Archiving evidence into the PR only completes "performance"; "signature" is still missing: the issue's Acceptance criteria checkboxes do not auto-check from `Closes #N` (#391 measured: ticket closed, evidence in the repo, three boxes still empty, user view = acceptance never happened). Before/after the PR merge, the lane must:

1. `gh issue view <ticket> --json body` take the body, change the delivered `- [ ]` to `- [x]` (only check boxes with real evidence support);
2. append the "acceptance record" section at the end of the body: PR number + merge date + evidence directory relative path (`docs/verify/<ticket>/`) + probe/e2e pass count (numbers must match the archived result.json / e2e log, no approximations);
3. `gh issue edit <ticket> --body-file <tmpfile>` write back (long bodies forbid inline `--body`).

Undelivered boxes are **not checked**, write the gap in the acceptance record. "Closing the ticket != acceptance done" - checked boxes + in-repo evidence pointer is the reviewable terminal state.

## Mechanism takes effect acceptance: artifact criteria (hard rule)

Mechanism-class changes (CSS/animation, on-disk/wire format, schema, config passthrough, service traffic) must be accepted on the **compiled artifact / runtime artifact**, not just source reading - "dependency installed, class written, config declared" none equal "took effect". Every "X takes effect" claim in an acceptance statement must answer **"where do I take X's artifact"**; **not obtainable = not accepted**. The truth trio (screenshot + API JSON + SQLite row) covers "is the functional behavior correct", this section covers "did the mechanism connect" - the same criterion hit three times in two days with three more same-shape cases (#746 summary), artifact-taking methods per class:

| Claim | Where the artifact is taken | Real case |
|---|---|---|
| "animation/CSS class took effect" | **compiled CSS**: `pnpm --filter @cairn/web build` then grep `apps/web/dist/assets/*.css` to pin the rule exists (evidence-form precedent `docs/verify/656/built-css-mechanism.txt`); the runtime reinforcement = the browser probe `getAnimations()` reading playState (`docs/verify/656/dialog-probe.json` shape). The automatable half opened as #747 | #656/#677: dependency installed, class written into JSX, `@import` declared, but B1 was not wired, all compiled empty |
| "shim/forwarding service has traffic" | **the service's own written file log** (e.g. `/tmp/pi-shim*.log`, one line per request), not journal/systemd - canonical source `docs/research/machine-execution-plane.md` "a shim-class service's traffic canonical source is /tmp not journal" | the pi-relay-shim traffic account: config looked right, journal always empty |
| "X's consumers zeroed, deletable / still alive" | **the current tree grep on the execution day**: fixed substrings across the repo (apps/, packages/, integration/, e2e) + enumerate dynamic concatenation points to check the value range, method canonical source `docs/verify/t-0031/README.md`; the audit-time list is only a snapshot, not the execution basis | t-0019 judged group H with 6 consumers left, the execution day zeroed them |
| "on-disk/wire format changed, all layers still compatible" | **each layer's actual reader list + each layer actually run**: unit pins (e.g. `apps/daemon/test/`) and integration pins (`integration/test/`, readers by current-tree `grep -rl daemon.log integration/test/`, ten-odd files) are two independent pin sets - a format-face change must **migrate all layers' harnesses in the same PR**, locally `VITEST_PROJECT_SET=integration pnpm test` not just unit; the coupling is on the runtime face (not the import graph), `vitest related` cannot select it | #735: daemon.log gained a wall-clock prefix, unit pins synced, integration not touched, first CI round all layers red |
| "shared schema change is fine" | **`packages/shared/test/snapshot.test.ts` run locally**: pins the zod schema's JSON projection, any schema-slot change must red; intentional projection updates use `-u`, block-review the diff then push | #700: `machineDoneBodySchema` gained `foundingsError`, locally not run, caught by CI |
| "field Y usable as criterion X" | **Y's runtime value in that form**: live-stack `curl /api/...` JSON + SQLite read-only rows (this doc's Observe face), and must be taken on the target form (e.g. manual projects) - "the code reads that field" != "the field has a value in that form" | #703/#704: the server-side `changes` projection is always empty on manual projects, using it as a criterion blocks all manual projects |

**Boundary with static gates** (repo rule: what can enter static analysis does not stay in docs): of the six rows, the "animation/CSS class took effect" compiled gate is automatable, opened as #747; the "shared schema" row's gate already exists (CI runs the snapshot suite), the discipline is a local run before push; the remaining four rows' artifacts are on the runtime / execution-day tree and cannot sink into a static gate, they rely on this table.

## Cleanup

```sh
node .../scripts/cleanup.mjs
```

Kills by the pid-file group (SIGTERM to 6s grace to SIGKILL), before killing checks the command line contains a `tsx|vite|pnpm` marker (guards stale pids from killing innocent processes); deletes `VERIFY_RUN_DIR` (scratch home + logs); echoes that the evidence directory remains. **Only kills processes recorded in its own pid files, never by process name**. The user's dev stack (8787/5173) and the e2e lane are unaffected.

Also **pinned reclamation of residual daemons** (#691): ad-hoc daemons leaked by launch/probe failures are not in the pid file, cleanup scans and reclaims by the dual marker "`cli.ts start` + this stack's `--server http://127.0.0.1:<VERIFY_PORT>`" (SIGTERM graceful stop to survivors upgraded to SIGKILL, re-checking the command line before the upgrade; no-port-pin refuses to sweep and hints). **Hard rule: cleaning residual daemons must never kill by the `cli.ts start` / `tsx` bare shape** - the user's main-checkout dev daemon is exactly `tsx src/cli.ts start -f`, same shape is bound to match (2026-10-02 23:38:17 hard proof #691: a lane used `ps aux | grep "cli.ts start" | kill -9` to clean its own residue, SIGKILLing the user's dev daemon along with it - the daemon died trace-free with zero output, pmset only saw caffeinate ClientDied, pnpm reported ELIFECYCLE exit 1, troubleshooting easily misread as a daemon self-crash).

## Helpers

| Script | Role |
|---|---|
| `scripts/launch.mjs` | start the isolated stack, write runtime state; self-kill on failure, no orphans |
| `scripts/doctor.mjs` | read-only health check |
| `scripts/drive.mjs` | Playwright probe (usage in this doc's Drive section) |
| `scripts/cleanup.mjs` | reclaim the stack, keep evidence |

Env contract (scripts agree): `VERIFY_REPO_ROOT` / `VERIFY_RUN_DIR` / `VERIFY_PORT` / `VERIFY_WEB_PORT` / `VERIFY_EVIDENCE_DIR`. Archive via `vp.mjs archive <ticket> --from <the evidence dir drive printed>`, then commit (this doc's "evidence archive discipline").

## When not to use this skill

- Visual regression → `apps/web` playwright e2e (the visual specs' computed-style geometric assertions pin rounded corners / height / font size etc. hard contracts).
- Fixture-face regression (UI popovers / interaction chains) → `apps/web` playwright e2e (`?scenario=`, E2E_PORT 8399). During development run only the relevant few, never the full set.
- Just want a quick curl API check → `curl http://127.0.0.1:<VERIFY_PORT>/api/...` directly, no browser needed.