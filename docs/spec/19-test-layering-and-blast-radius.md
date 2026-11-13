# 19 · Test Layering Responsibilities and Blast Radius (#693)

> Scope: establishes each of the four test layers' run responsibilities — during development locally **no longer runs the full e2e**, a change only runs the **affected surface**; the full e2e's execution point converges to **CI (4 shards)**. Includes baseline measurement (2026-10-03, this machine 8 cores / 16GB), the affected-surface selection mechanism (`e2e:affected`), the vitest `related` / `--changed` usability verification, and the comparative assessment of pi's cheap structural gate (**assess + propose only, this ticket does not land**). Reference implementation = `~/Code/AgentProjects/pi` (599 .ts tests are mostly package-level unit/integration, the browser layer keeps only one esbuild bundling smoke).

## Problem Statement

1. **Duplicate labor at the most expensive layer.** The local full e2e measured 154.3s / 617 cases (see below), CI already runs the same set (223s/step). Running the full set locally during development = repeating CI's work the most expensive way; on a 16GB machine under multi-lane parallelism (the real pressure of compressor 4.45GB + swap 3.89GB), the full e2e's +44 processes / +3.4GB peak is exactly one of the crush points.
2. **No affected-surface selection.** Changing the chief drawer, one can only run all 83 specs, or hand-pick a few by feel — hand-picking has no mechanism backstop, missing a run reads as a false green.
3. **The old caliber is distorted.** "A full `apps/web` e2e run takes 1h+" is wrong (measured 154s), the distorted cost perception defocuses the "run full or not" discussion.

## Baseline (measured 2026-10-03, measured once then frozen)

Measurement environment: this worktree, pnpm cold-installed, no concurrent e2e. The e2e process/memory = a 1s sampler sampling the system node/vite/chromium/playwright family throughout, taking "running peak − pre-run watermark".

| Layer | Wall clock | Scale | Memory / process contribution |
|---|---|---|---|
| web e2e full (fixture build + preview + playwright) | **154.3s** | 617 cases / 83 specs all passed | **+3.38GB / +44 processes** (watermark 94 processes / 3.02GB → peak 138 / 6.40GB) |
| vitest light (all packages' colocated unit tests) | 40.1s | — | single process 336MB |
| vitest integration (real server + daemon + Chromium) | 124.1s | 58 cases / 19 files | sampling peak +2.3GB / +28 processes |
| verify-cairn live probes | not measured | — | ticket-level acceptance probes, not in the development loop (see the responsibility table) |

CI side (step breakdown of the green run 37098721348): check job 7.4min, among which **the e2e step 223s is the largest single item**; vitest light 45s, integration 112s, typecheck 7s. The three layers' "run it all once" local time shares: e2e 48% / integration 39% / light 13% — the weight really is on the browser layer and the stack layer.

## Layering Responsibility Table

`pnpm prepush` runs fast checks only, including script self-tests and workflow test steps. Vitest, the full `@cairn/web` unit suite and e2e run in CI as required checks. A push is unverified until CI reports on that head. During development, run related tests by hand with `pnpm exec vitest run --changed` and `pnpm --filter @cairn/web e2e:affected`.

| Layer | Shape | When to run (responsibility) | Entry |
|---|---|---|---|
| **unit** | vitest projects, each package colocated `test/`, pure functions / schema / mapper | **CI required check**; run related tests by hand during development | `pnpm test`; affected surface `pnpm exec vitest run --changed` |
| **stack integration** | vitest `integration` project: in-process real server + daemon + Chromium walking the full chain | **CI required check**; run related tests by hand when changing the server / daemon / shared contract surface | `VITEST_PROJECT_SET=integration pnpm test` |
| **web e2e** | playwright fixture surface: 83 specs / 617 cases, UI behavior and geometry | **development runs the affected surface**; **the full set goes to CI (4 shards)**; local full only when a final review really needs it | affected surface `pnpm --filter @cairn/web e2e:affected`; full `pnpm --filter @cairn/web e2e` |
| **verify-cairn** | isolated live stack (8791/5273 + independent CAIRN_HOME) walking real user paths | **ticket-level acceptance** (proof before delivery that "it really runs", not daily regression) | `.claude/skills/verify-cairn/SKILL.md` |

One-sentence memory: **prepush runs fast checks, CI owns suite results, development uses related tests by hand, live probes provide ticket-level acceptance.**

## e2e Affected Surface: `e2e:affected`

Mechanism (`scripts/e2e-affected.mjs`, after selecting specs it runs through the **standard fixture-build config** — measured fixture build only ~1s (vite 8), all the speed comes from the selection itself (full 617 cases vs a single domain's dozens), fidelity identical to CI, no independent fast-channel config needed, and token-gate needs no special handling (its self-start server serves exactly the dist the webServer just built):

- **Selection**: no args = all change paths of the worktree + branch vs `origin/main`; explicit paths = `pnpm --filter @cairn/web e2e:affected -- <paths>`; `--dry-run` only prints the selection result.
- **Mapping**: the spec family = the e2e filename prefix (`chief-`, `sidebar-`…); source path → family goes through `scripts/e2e-affected.mjs`'s table (directory-level mostly, `src/board/sidebar.tsx`, `src/routes/*` and other file-level overrides). **Conservative over-inclusion**: running one extra spec only costs seconds, missing one reads as a false green — the mapping table prefers over-inclusion, and it is a **signal not a guarantee**: the only complete gate is the CI full run.
- **Shared surface → full fallback**: `src/ui` `src/styles` `src/i18n` `src/api` `src/fixtures` `App.tsx` `main.tsx` `theme.ts` `phase.ts`, playwright/vite configs, `e2e/evidence.ts` `e2e/png.ts`, the runner itself (`scripts/e2e-affected*.mjs`, `scripts/heavy-slots.mjs`, `scripts/timed-partition.mjs`), unmapped `apps/web/**` paths — these changes' honest affected surface is all specs.
- **web unit-test layer → no e2e selected** (#1455): `apps/web/test/**` and `apps/web/vitest.config.ts` belong only to vitest, they do not enter the playwright-hosted fixture build, and e2e does not import them — the affected surface is empty, coverage carried by `pnpm exec vitest run --changed origin/main` (without a ref it only looks at uncommitted changes, committed unit tests get missed, see the `--changed` section below). `apps/web/DESIGN.md` (imported by the design gallery) selects the design specs, `apps/web/COMPONENTS.md` none; other unmapped `apps/web/**` still fall back to the full set.
- **e2e-directory helper modules → narrow by import** (#1463): when a non-spec module at the `e2e/` top level (`.ts`/`.mjs`/`.js`, e.g. `helpers.ts`) changes, only select the specs that import it, following the chain through intermediate modules (spec → `helpers.ts` → the changed file, passing through specs imported by other specs). Narrow only when "every place mentioning this file is a static relative import among top-level e2e files"; everything else falls back to the full set: non-top-level modules (subdirectories, css/png/json, dotfiles, new directories), mentioned non-import ways (spawn paths, file reads, template strings), the chain hitting a full-table file or subdirectory file, `playwright.config.ts` or `apps/web/package.json` mentioning, or no spec found at all. When the chain passes a module that has a file mapping, merge in the spec it maps to. `e2e/evidence.ts` `e2e/png.ts` stay in the full-fallback table; `live-server.ts`, `live-server-tether.mjs`, `live-server-spawner.ts` three still go through file mapping.
- **Snapshot baselines**: `e2e/<spec>.spec.ts-snapshots/**` selects only `<spec>.spec.ts`.
- **`pnpm-lock.yaml` / `pnpm-workspace.yaml` → compare what is installed**: both files share one comparison of the base and head lockfiles. The dependency closure of the root and `apps/web` importers (following `link:` workspace packages and every snapshot's `dependencies` / `optionalDependencies`, with each snapshot's package entry) is compared: any difference runs all specs. The same closure of `apps/server` differing runs the live-server specs. A workspace build-permission change (`allowBuilds`, `onlyBuiltDependencies`, …) counts as a difference for whichever closure installs that package. Settings whose effect lands in the lockfile (`catalog`, `overrides`, `packages`, …) are judged through the lockfile; any other workspace setting or lockfile top-level key change, a missing merge base, or a lockfile the reader cannot parse runs all specs.
- **Workspace packages → who links them**: a path inside another workspace package (an importer of the head `pnpm-lock.yaml`, longest directory first) is judged by the `link:` closure of the same importers: a package the root or `apps/web` reaches, directly or through another package (`packages/shared` today), runs all specs; one only `apps/server` reaches runs the live-server specs; one neither reaches (`apps/daemon`, `integration`, `site` today) selects none. A head lockfile the reader cannot parse runs all specs for every path outside both apps.
- **`apps/server/**`**: on the e2e surface only token-gate starts a real server; the real coverage surface is the stack-integration layer above.
- **Ports**: the affected surface defaults to `E2E_PORT=8398` (`E2E_AFFECTED_PORT` override; an explicit `E2E_PORT` is honored) — separate from the full run's 8399, so on a multi-lane machine `reuseExistingServer` does not quietly test another lane's build (same discipline as #137: port collision means switch ports, not kill the neighbor lane). The Playwright configuration used by `e2e:affected` first acquires a slot, so the port it actually binds is the slot's (base + (slot-1)*10), never a slot port it did not lease.

- **Same-machine quota** (#3584): every repository Vitest and Playwright configuration awaits `scripts/test-admission.mjs`, backed by `scripts/heavy-slots.mjs`, before starting workers or webServer builds. Root, package-local and alternate screenshot configs share one admission Promise per runner process. The lease lasts until runner exit; workers and descendants reuse a verified ancestor's lease without releasing it. `e2e:affected`, prepush Vitest and shard wrappers only forward commands; `cairn-heavy` delegates to the same CLI. Capacity defaults to 2 (`CAIRN_HEAVY_SLOTS` overrides it; invalid values become 1 with a warning). Locks record pid and cwd, and waiting output names the live holders. A permanent guard FD holds each slot's kernel flock through Python 3's standard library; metadata is replaced while holding that guard, and process death releases the FD. The allocator never unlinks guard files. The shared directory is `CAIRN_HEAVY_SLOTS_DIR`, otherwise `os.tmpdir()/cairn-heavy-slots` on Linux or the Darwin user temp directory on macOS. Never set `TMPDIR` without the shared-directory override. CI bypasses only if its resolved slot directory is absent, and does not create it on bypass. Selection-only dry runs do not load a runner configuration or acquire a slot.
- **Leased e2e resources**: the standard Playwright configuration selects port base + `(slot-1)*10` and `os.tmpdir()/cairn-heavy-slot-N/web-dist` after admission. It publishes the build path through `E2E_DIST_DIR` for live-server tests. Direct runs default to base 8399; affected runs forward base 8398 or `E2E_AFFECTED_PORT`; explicit `E2E_PORT` overrides the base. Before building, the runner checks the leased port and reports a squatter's pid, cwd and command. Worker config reloads skip that check because the admitted runner already started its server. CI without a slot keeps the checkout's build directory and configured base port.


Maintenance rule: when adding a spec, if its prefix is in no family and it is not shared-surface-specific, hang the prefix into the corresponding source-path table entry; a prefix matching no spec at runtime prints a WARNING (a visible signal of table rot).

## CI Sharding (coverage undiminished)

**`e2e-affected` (local selection; CI pull requests no longer run it)**: a 5-runner matrix; every runner computes the same selection, then `e2e:affected --shard=i/n` keeps its part of a greedy longest-first partition over `scripts/e2e-shard-weights.json` (per-spec milliseconds summed from the list reporter; a spec without a recorded time weighs the median), so each runner runs one Playwright instance on roughly an equal share of time. A runner whose part is empty exits without starting Playwright; the CSS mechanism gate runs on runner 1 only. Refresh the weights from a CI run whose `e2e-affected` runners passed a full-fallback selection: `node scripts/e2e-shard-weights.mjs <run id>` (it overwrites the recorded specs and drops deleted ones).

**`e2e` (pushes and merge-queue drafts)**:

`.github/workflows/ci.yml`: e2e extracted from the check job into an independent `e2e` job, `strategy.matrix` 4 shards, `--shard=i/4` (playwright splits precisely by case, **union = the full 83 specs**), `fail-fast: false` (one shard red does not mask the rest). The chromium install moves with it (no more apt ffmpeg install: no shard calls system ffmpeg, that step once stuck for 42 minutes); the check job no longer installs the browser surface. Benefit: e2e (223s serial step) leaves the check job's critical path, one shard ≈ setup + build + 1/4 of the cases; the check job keeps drizzle / typecheck / vitest×2 / lint. Each shard owns its runner, token-gate and webServer work on their own dist, the "same runner mutual dist writes" constraint disappears with the job boundary.

**Are the shards really splitting (#765 criterion)**: `pnpm --filter @cairn/web e2e -- --shard=i/4` this writing **does not split** — pnpm forwards `--` verbatim to the script, playwright receives a `--` positional argument, `--shard` swallowed, the four shards each run the full set (run 37134551409: four jobs all print `Running 688 tests`, the same probe spec red in all four; single shard 4m03–5m32). Dropping the `--` is the real forwarding: `pnpm --filter @cairn/web e2e --shard=i/4` (measured 173/171/… cases/shard, union = the full 688 cases / 90 specs). The criterion stays on the job logs: each shard's `Running N tests` sum = the full set and non-overlapping.

The other half of "coverage undiminished" is in the **merge gate**: branch protection's required contexts reference `e2e-gate` (the aggregate job needing all shards, stable context name) rather than per-shard names — if the list hardcodes the matrix cardinality, a future shard-count change silently mismatches, the new shard does not block merge.

The aggregate job itself has a criterion (#762): must be `if: always()` and explicitly judge `needs.e2e.result == 'success'`. Branch protection lets `skipped` through on par with `successful` / `neutral`, while writing only `needs` makes the aggregate job skip entirely on any shard failure — **the gate opens at the only moment it is needed**. Measured three red runs (37130371196 / 37128928219 / 37125498051) all concluded `e2e-gate` as `skipped`; after `always()` + explicit judgment the same conditions report `failure`.

**CI tiers** (C1): the 4-shard `e2e` job runs only on pushes and on the draft PRs Mergify opens for a queued batch (`draft`, author `mergify[bot]`, head `mergify/merge-queue/*`); an ordinary pull request runs neither e2e tier unless it changes `apps/web/src/`; a ready (non-draft) pull request that does runs the `e2e-affected` tier, so a stale gallery screenshot baseline fails on the pull request instead of in the queue, while a change that breaks a page the author did not touch is still caught by the queue draft's full run. The `changes` job publishes the choice as `e2e-tier` (`full` / `affected` / `none`), and `e2e-gate` passes when the picked tier ran and the other job was skipped, or when `none` left both skipped; a docs-only classification still lets both skip. A push to `main` reports `tested-in-queue` and skips the test, e2e and sidecar jobs only when every commit's pull request has a Mergify `Passed · draft #N` comment, that draft's required checks succeeded before the merge, and the draft head tree equals the landed commit tree. A closed pull request by `mergify[bot]` whose head is `mergify/merge-queue/*` is not that pull request: the audit and the tree check follow the original numbers named in its title or body (`Merge of #N`, Mergify's `merge queue: merged #N`, or the `pull_requests` list) and do not judge the draft. A queued label alone, a draft that tested a different tree, or a check that had not finished runs the full suite. `check-core`, `gates` and `warm-caches` (which refills the shared pnpm and Playwright package caches) still run, and the run's result still drives `autonomy-brake`. A direct push or a merge outside the queue runs everything. `scripts/ci-tiers.test.mjs` evaluates these conditions and runs the gate shell over every result combination.

## vitest Affected Surface (usability verified, 2026-10-03)

- `pnpm exec vitest related <source file>`: **usable** — root-level cross-project effective (measured `apps/web/src/board/dnd.ts` → exactly `dnd.test.ts` 7 cases, 2.1s).
- `pnpm exec vitest run --changed [since]`: **usable** (vitest 5.0.1 native; by default compares HEAD's uncommitted changes, with a ref compares that ref, and takes related tests by git change). Measured 2026-10-20: `--changed a1e7254~1` selected 22 test files.
- `pnpm exec vitest related --changed`: **unusable, always selects 0 tests**. The `related` subcommand writes the positional argument (here an empty array) into `config.related`; `filterTestsBySource` only goes through git to take changed files when `!config.related`, the empty array is truthy, so it skips the lookup, then `related.length === 0` returns empty directly (`filterTestsBySource` in `vitest/dist/chunks/index.*.js`). Under the same ref measured `No test files found`, exit 0 — no error, so it looks like "no affected tests". #1398 thus missed a broken unit test (`test/chief-identity.test.ts`).
- Position: the vitest layer's volume is small anyway (light 40s), the affected surface is a **handy narrowing** not a necessity; the stack-integration layer keeps running whole (its "affected surface" criterion = whether you changed the contract surface, a human-judged semantic question the script cannot replace).

## pi Cheap Structural Gate Comparative Assessment (assess + propose, this ticket does not land)

| pi's gate | cairn current | Assessment |
|---|---|---|
| pinned-deps (dependencies fully pinned) | pnpm catalog + `--frozen-lockfile` (CI) + the pre-commit lockfile gate | **equivalent already exists**, shape different (pi has no workspace catalog so it needs a script to pin) |
| runtime-deps (forbid runtime deps at build time) | biome `noRestrictedImports` seam discipline (backend/MCP/LLP seams) | **equivalent already exists** (the lint surface is stronger: directly locks import paths) |
| ts-imports (relative import style unified) | biome organizeImports | covered, not a risk surface |
| entry-graphs (the browser bundle must not pull node-only modules) | single browser app (apps/web), the vite build itself is this gate | **low value not proposed**: pi's risk exists only in its multi-package published browser/node dual shape |
| shrinkwrap / install-lock (published artifact reproducible install) | CI's `pack-smoke` job (#264) smoke-tests the main-package tarball | **equivalent already exists** |
| hermetic test environment (test.sh: empty env + temp HOME + zero credentials) | partially equivalent: stack-integration/token-gate each `mkdtemp` + independent `CAIRN_HOME`; but the full vitest still inherits the machine env | **the only one worth proposing**: local tests may read the real `~/.cairn` / credentials causing false green/false red. Propose a later single ticket: a local `test:hermetic` wrapper (empty env + temp HOME). CI is naturally hermetic, no change needed |

Conclusion: five of the six already have a different-shaped cairn equivalent, copying verbatim is duplicate construction; the only worthwhile addition is the hermetic environment, and it should be a separate ticket (the change surface is every test's startup mode, not mixed into this ticket).

## Acceptance Cross-Reference (#693 list → landing spot)

- measure baseline → the table above (one measurement, numbers into `docs/verify/693/`)
- layering responsibility table → this doc (the thread-task template references this path from the coordination side)
- affected-surface selection → `e2e:affected` + the mapping table + the vitest `related`/`--changed` verification
- CI sharding → ci.yml `e2e` job (coverage undiminished: shard union = full)
- cheap structural gate assessment → the section above (assess + propose only)
- "one command < 1/5 of baseline" and evidence → `docs/verify/693/` (time / memory comparison JSON + explanation)

## Global Gesture Single Source (#1267)

When the thread-task template's blast-radius item references this file, the global gesture's single source is `apps/web/src/overlay/gesture-machine.ts`.

Escape close-layer and the Coordinator settings view are computed only in that file's `reduceGesture`. Consumption points dispatch events, do not hold their own booleans, and do not register a second window-level Escape listener. New global gestures add into that file's event table and `bindGestureKeys`.

⌘J is navigation, not state: the one listener in `apps/web/src/chief/chief-root.tsx` sends you to the Coordinator page through `useOpenComposer`. There is no floating Coordinator to open or close; `apps/web/test/no-floating-coordinator.test.ts` guards that.

Page-private chords (⌘K search, C new task, new-task Tab) are not this machine's state.