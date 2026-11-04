# #1241 machine-recommended concurrency: live-environment evidence

Branch `concurrency-1241` (worktree `/workspace/wt-1241`, issue #1241, the #1241 PR pending merge).

Driver probe: `.claude/skills/verify-pacman/scripts/drive-1241-recommended-concurrency.mjs`
(a custom probe registered to the same family as `scripts/drive.mjs`; the five assertion families A recommendation / B basis / C manual / D restore-recommendation / E estimate).

## Live environment

| dimension | value |
|---|---|
| host | `grok-bot-vm-481311088` (Linux x86_64, a Docker container) |
| cores | 8 (`os.cpus().length`) |
| total memory | 16,002 MiB (≈ 15.6 GiB, `os.totalmem()`) |
| available memory | 4,931 MiB (≈ 4.8 GiB) |
| the formula | `min(8, floor(16002 / 2048)) = min(8, 7) = 7` |
| the recommended value (measured) | 7 |
| the estimated value (estimate, no fingerprint) | 3 (`CONSERVATIVE_CONCURRENCY`) |

## Ports and stacks

In the local port fleet, 8791 is already held by `sand-egress-tun` (pid 363, a system service, must not be killed), so per the skill's "ports and lane discipline" we switch to `8796` / `5278` (a fallback within the task spec), with the before/after comparison on the same stack to avoid port-drift cross-interference.

| stack | REPO_ROOT | RUN_DIR | server | web |
|---|---|---|---|---|
| before | `/tmp/wt-1241-before` (origin/main HEAD `9b027a5c`) | `/tmp/wt-1241-before/.claude/verify-run` | 8796 | 5278 |
| after | `/workspace/wt-1241` (`concurrency-1241` `6cf9cd74`) | `/workspace/wt-1241/.claude/verify-run` | 8796 | 5278 |

## The formula (apps/server/src/services/dispatch-eligibility.ts)

```
recommended = clamp(min(cpuCores, floor(memoryTotalMb / 2048)), 1, 16)
```

Constants: `CONCURRENCY_FLOOR = 1`, `CONCURRENCY_CEILING = 16`, `MEMORY_GB_PER_SLOT = 2`,
`CONSERVATIVE_CONCURRENCY = 3`. **The convention = total memory** (`memoryTotalMb`, not `memoryAvailableMb`),
per the basis popover's copy `总内存 15.6 GiB` and aligned with the B1 assertion; the available memory is only shown in a secondary position of the basis block.

## Priority (the issue #1241 comment, binding 2026-10-12)

```
a user-patched number  >  the formula (measured, has fingerprint)  >  the conservative estimate (estimate, no fingerprint)
```

| state | maxConcurrentOverridden | maxConcurrent | concurrencySource | recommended field sent |
|---|---|---|---|---|
| user-written | true | the user value | manual | the formula value |
| not overridden, has fingerprint | false | the formula value | measured | the formula value |
| not overridden, no fingerprint | false | 3 | estimate | 3 |

PATCH `null` = clear the override and immediately recompute per the current fingerprint; a heartbeat missing `hardware` keeps the previous beat's fingerprint and does not push an already-measured recommendation back to an estimate; a load pause only blocks new claims and does not take effect on override.

## Evidence list

`docs/verify/1241/`
- `before/` — measured on a throwaway origin/main worktree stack
  - `00-before-machines-page.png`: the two machines side by side (the real machine + the estimate machine), both `并发 3` with no annotation
  - `api-machines-t0.json`, `db-machine-t0.json`: both ground-truth fields `maxConcurrent=3`, no `recommendedConcurrent` / `concurrencySource`
  - `daemon-console.log`: the daemon's startup and online lines (no fingerprint field)
  - `result.json`: 3/3 PASS (O1 / O2 / O3)
- `after/` — measured on concurrency-1241 (the same ports 8796/5278, the same host fingerprint)
  - `01-recommended-tag.png`: the real machine's control reads `并发 7 推荐`, the estimate machine's `并发 3 估算`
  - `02-basis-popover.png`: the basis popover `推荐 7 · 依据：核 8 · 总内存 15.6 GiB · 负载 1.01`
  - `03-manual-override.png`: after picking 4, `并发 4 手动`
  - `04-after-reset.png`: after restoring the recommendation it returns to `并发 7 推荐`
  - `05-estimate-basis.png`: the estimate machine's popover `未收到能力指纹，按保守默认 3 估算`
  - `api-machines-t0.json` / `api-machines-after-manual.json` /
    `api-machines-after-heartbeat.json` / `api-machines-after-reset.json`: the four-time-point API ground truth, covering the `concurrencySource` three states + the formula value and the user value coexisting + the heartbeat not overriding
  - `db-machine-*.json`: the four-time-point SQLite row-level ground truth (the `maxConcurrentOverridden` 0/1 switch, the `capabilities.hardware` field persisted)
  - `daemon-console.log`: the real daemon's online line (carrying the hardware field report)
  - `result.json`: 20/20 PASS (A0..A5 / B1 / C0..C4 / D0..D3 / E0 / E2..E4)

## Two-way contrast (before vs after)

| dimension | before (origin/main) | after (concurrency-1241) | criterion |
|---|---|---|---|
| real machine UI control | `并发 3` | `并发 7 推荐` | O1 red / A1 red |
| estimate machine UI control | `并发 3` | `并发 3 估算` | O2 red / E0 red |
| real machine API `recommendedConcurrent` | field missing | 7 (the formula value) | O3 red / A2 red |
| real machine API `concurrencySource` | field missing | `"measured"` | O3 red / A0 red |
| the basis popover | none | `依据：核 8 · 总内存 15.6 GiB · 负载 1.01` | — / B1 red |
| PATCH a number → manual | the semantics unsupported (no source field) | `并发 4 手动`, SQLite `maxConcurrentOverridden=1` | — / C0/C1/C2/C3 |
| heartbeat overriding the manual value | — | still 4 after 30s (the override value persists) | — / C4 |
| restore the recommendation | — | `并发 7 推荐`, `overridden=0` | — / D1/D2/D3 |
| estimate machine capabilities | (no field) | null, the formula not executed, the value pinned at 3 | — / E2/E3/E4 |

## Failure-mode-first, item by item

| failure mode | probe assertion | criterion field |
|---|---|---|
| formula drift (floor→ceil, wrong memory convention) | A2 | `recommendedConcurrent === min(cpuCores, floor(memoryTotalMb/2048))` |
| the basis eats the available memory | B1 | the popover copy contains `总内存 15.6 GiB` (not 4.8) |
| a heartbeat overriding the manual value | C4 | `maxConcurrent === 4` and `lastSeenAt` advancing |
| the `overridden` residue after restoring the recommendation | D2 / D3 | both API and SQLite read `maxConcurrentOverridden === false/0` |
| a no-fingerprint machine called a recommendation | E0 / E2 | `data-concurrency-source="estimate"`, API `capabilities=null` |

## Rerun recipe

```sh
# before stack (a throwaway origin/main worktree)
VERIFY_REPO_ROOT=/tmp/wt-1241-before VERIFY_PORT=8796 VERIFY_WEB_PORT=5278 \
  VERIFY_RUN_DIR=/tmp/wt-1241-before/.claude/verify-run \
  node /workspace/wt-1241/.claude/skills/verify-pacman/scripts/launch.mjs
VERIFY_REPO_ROOT=/tmp/wt-1241-before VERIFY_RUN_DIR=/tmp/wt-1241-before/.claude/verify-run \
  node /workspace/wt-1241/.claude/skills/verify-pacman/scripts/drive-1241-recommended-concurrency.mjs --expect=old
VERIFY_RUN_DIR=/tmp/wt-1241-before/.claude/verify-run \
  node /workspace/wt-1241/.claude/skills/verify-pacman/scripts/cleanup.mjs

# after stack (concurrency-1241)
VERIFY_REPO_ROOT=/workspace/wt-1241 VERIFY_PORT=8796 VERIFY_WEB_PORT=5278 \
  VERIFY_RUN_DIR=/workspace/wt-1241/.claude/verify-run \
  node /workspace/wt-1241/.claude/skills/verify-pacman/scripts/launch.mjs
VERIFY_REPO_ROOT=/workspace/wt-1241 VERIFY_RUN_DIR=/workspace/wt-1241/.claude/verify-run \
  node /workspace/wt-1241/.claude/skills/verify-pacman/scripts/drive-1241-recommended-concurrency.mjs --expect=new
VERIFY_RUN_DIR=/workspace/wt-1241/.claude/verify-run \
  node /workspace/wt-1241/.claude/skills/verify-pacman/scripts/cleanup.mjs
```

## Measured pitfalls

1. **Port 8791 occupied**: `sand-egress-tun` (pid 363, a system service) already holds 8791 and must not be killed; per the skill's discipline we moved to 8796/5278.
2. **The core `pnpm` unusable**: `/home/box/.cache/corepack/pnpm/12.5.1/bin/pnpm.cjs` file missing; use `/tmp/1241-bin/pnpm` (pointing at `/usr/local/share/corepack/pnpm/10.34.6/bin/pnpm.cjs`) to start the pre-commit hook; `corepack pnpm exec tsx` resolves `node_modules/.bin/tsx` under the `apps/<pkg>/` subpackages, and the cross-subpackage bridge works.
3. **A co-running change needs a re-launch**: vite's `**/.claude/**` watch-ignore does not cover `apps/web/src`, but the worktree's own `.claude/verify-pacman/scripts/` is outside the watch scope — editing a probe script while the stack runs does not take effect hot; a re-launch suffices (launch re-reads `launch.mjs` in a detached process).

## The final version (option A + the elastic range + the stepper input, `39e2da21`)

The evidence directory `final/` (probe 32/32 PASS, server 8799 / web 5279, node22).

```
range.max   = clamp(round(memoryTotalMb / 1024), 1, 16)      # 1 GiB per slot
recommended = clamp(min(cpuCores, round(memoryTotalMb / 2048)), 1, 16)  # 2 GiB per slot
no fingerprint      = range 1..8, recommended 3 (estimate)
```

| machine | hardware | selectable | recommended |
|---|---|---|---|
| grok-bot-vm / verify-1241-real | 8 cores / 15.6 GiB | 1-16 | 8 |
| verify-1241-36gb (a fake machine) | 12 cores / 36 GiB | 1-16 | 12 |
| verify-1241-estimate (no fingerprint) | — | 1-8 | 3 |
