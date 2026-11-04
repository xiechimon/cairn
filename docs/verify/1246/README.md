# #1246 before/after evidence: team chart with a single child

Branch: `team-chart-1246` at `43bd4ecd`. Baseline: `origin/main` at `c6fd0309`, checked out in `/tmp/wt-1246-before`.
No source code changed. No commit, no push.

## What the bug looks like

The chart's bracket column assumes at least two children. A chart whose only child is the creation slot has a bracket box whose top and bottom insets consume the full column height. The border collapses into a floating 2px dash. The connector is 44px wide, but the bracket column is 28px wide, so the connector stops short of the child card and leaves a gap.

"Single child" in the code means no member agent besides the chief. The creation slot counts as the one child, so the chart is chief plus the slot.

## Screenshots

All screenshots are 1440x900 full-page captures of `/app/team`, chart tab, from the live verify stack (no `?scenario=`). Geometry values are `getBoundingClientRect` readouts saved as `geom-*.json`.

**before.png** (origin/main, live stack on port 8795). Chief "Planner" with one creation slot.
- The bracket is a 28x2 dash at x=721, y=127. It is a floating stub, not a bracket.
- The connector runs 44px from x=677 to x=721, then the creation slot begins at x=749. The 28px gap breaks the line.

**after.png** (branch `43bd4ecd`, live stack on port 8794). Same team state.
- The bracket column is not rendered.
- The 44x1 connector runs from x=677 to x=721 at y=127. The creation slot starts at x=721 with its vertical center at y=127. The line joins the child directly.

**before-multi.png** and **after-multi.png** (regression, 5 members plus the creation slot, 6 children). Both show the same tree.
- The bracket is 28x320 at x=721, y=127, spanning from the first child to the creation slot.
- The connector is 44x1 at y=287.
- Pixel diff of the two PNGs: `ImageChops.difference` bbox is `None`, so the images are identical.

## How the states were produced

- Each stack started from a fresh scratch database. The seed adds five member agents (Implementer, CodeReviewer, SecurityAuditor, TestEngineer, Verifier) under chief Planner.
- The multi-child screenshots were taken before any deletion.
- For the single-child state, the script deleted those five agents through `DELETE /api/teams/:id/agents/:aid` on each scratch stack. Planner remained. This only touched the scratch databases.

## Tests and checks

Full output is in `tests.log`.

| Check | Command | Result |
|---|---|---|
| Lint | `pnpm lint` (`biome ci .`) | exit 0. 762 files checked, 53 warnings, 1 info. The origin/main worktree shows the same 53 warnings and 1 info, so none are new. |
| Typecheck | `pnpm typecheck` | exit 0 for shared, daemon, server, web, and integration. |
| Spec parse | `pnpm spec:parse` | PASS. 945 e2e tests in 131 files collected. 30 integration files parsed. |
| Unit (related) | `pnpm exec vitest related --run` on the four changed fixture and route files | 21 files, 223 tests, all pass. No unit test targets the team chart directly. |
| E2E | `playwright test team-chart-single team-org-chart` in `apps/web`, E2E_PORT 8399 | 13 of 13 pass. This includes the new `team-chart-single.spec.ts`, which covers the single-child, pair, and empty-team states in fixture mode. |

## Commands run

```sh
# stacks (ports 8791/5273 are occupied by other processes, so 8794/5276 and 8795/5277 were used)
VERIFY_PORT=8794 VERIFY_WEB_PORT=5276 VERIFY_RUN_DIR=/tmp/verify-1246-after node .claude/skills/verify-pacman/scripts/launch.mjs
VERIFY_REPO_ROOT=/tmp/wt-1246-before VERIFY_PORT=8795 VERIFY_WEB_PORT=5277 VERIFY_RUN_DIR=/tmp/verify-1246-before node /tmp/wt-1246-before/.claude/skills/verify-pacman/scripts/launch.mjs

# screenshots (script in this directory, shoot-1246.mjs)
node shoot-1246.mjs http://127.0.0.1:5276 after-multi.png
node shoot-1246.mjs http://127.0.0.1:5277 before-multi.png
python3 (delete seeded agents, keep Planner)
node shoot-1246.mjs http://127.0.0.1:5276 after.png
node shoot-1246.mjs http://127.0.0.1:5277 before.png

# checks
pnpm lint; pnpm typecheck; pnpm spec:parse
pnpm exec vitest related --run apps/web/src/routes/team-chart.tsx apps/web/src/fixtures/team.ts apps/web/src/fixtures/scenario.ts apps/web/src/fixtures/fixtures.ts
cd apps/web && pnpm exec playwright test team-chart-single team-org-chart --reporter=line

# cleanup (both stacks stopped; their scratch run dirs deleted)
VERIFY_PORT=8794 VERIFY_WEB_PORT=5276 VERIFY_RUN_DIR=/tmp/verify-1246-after node .claude/skills/verify-pacman/scripts/cleanup.mjs
VERIFY_REPO_ROOT=/tmp/wt-1246-before VERIFY_PORT=8795 VERIFY_WEB_PORT=5277 VERIFY_RUN_DIR=/tmp/verify-1246-before node /tmp/wt-1246-before/.claude/skills/verify-pacman/scripts/cleanup.mjs
```

## Environment notes and deviations

- Port 8791 (the skill default) is held by a process I did not start (`sand-egress-tun`). Port 8793 and 5275 are also held by other processes. The stacks used 8794/5276 and 8795/5277 instead. Other listeners on 8790, 8791, 8792, 5274, 8793, and 5275 were not touched.
- The repo's `.claude/verify-run` already held a live stack (server 8792, web 5274) from another session. I did not stop it. Both of my stacks used separate `VERIFY_RUN_DIR` paths, and I never ran the default cleanup, which would have hit that stack.
- `/usr/bin/pnpm` fails against the corepack cache (`Cannot find module .../pnpm.cjs`). I ran pnpm through a shim at `/tmp/pnpm-shim-1246/pnpm` that calls `corepack pnpm`. Nothing in the repo changed.
- Playwright browsers were not installed. The screenshot script used `/usr/bin/google-chrome`. The e2e run used a `chromium-headless-shell` installed with `playwright install`.
- The chromium install was not a repo change. The `apps/web/dist` and `test-results` outputs from the fixture e2e run are gitignored.
- Fixture-mode screenshots were not captured. The live stack was used for all screenshots, and the fixture scenarios are covered by the e2e run.
