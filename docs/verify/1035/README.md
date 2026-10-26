# #1035 zoom-fit board at wide viewports — verify-pacman evidence

The fix: the column-width floor splits into two states by the `.board-shell`'s existing `data-chief-open` marker — normal
`--board-col-min: 200px` / ⌘J docked `--board-col-min-docked: 280px`
(single source in `apps/web/src/styles/tokens.css`, the switch utility class hangs on the shell in `board-page.tsx`,
the same two-state shape as detail-shell D7's `--detail-pane-right`). The track rule itself does not branch and does not enter min() (the ticket's counterexample).

## Results at a glance

| face | result |
|---|---|
| after (this branch's stack 8791/5273) | `drive-1035-zoom-fit.mjs --expect=new` **9/9 PASS** |
| before (a throwaway origin/main worktree stack 8793/5275) | `--expect=old` **5/5 PASS** (the lesion reproduced) |
| fixture e2e | the new `apps/web/e2e/board-zoom-fit.spec.ts` 6 cases; `board-docked-reflow` 10 + `chief-panel` 14 all green; the web full suite 824 passed (E2E_PORT 8403) |
| mechanism artifact (the compiled CSS) | `after/compiled-css-after.txt` vs `before/compiled-css-before.txt` |

## Measured boundary table (the sweep raw values in after/result.json, 1440 physical width)

Zoom is simulated by the CSS viewport's equivalent width (1440/z; the layout geometry is decided by CSS pixels only).

| tier | CSS viewport | scroller client/scroll | all four columns visible | per-column width | page-level overflow |
|---|---|---|---|---|---|
| 100% | 1440 | 1200/1200 | yes | 281 (1fr-led, value-identical to before the change) | 0 |
| 110% | 1309 | 1069/1069 | yes | 248.3 | 0 |
| 120% | 1200 | 960/960 | yes | 221 | 0 |
| 125% | 1152 | 912/912 | yes | 209 | 0 |
| ~129% | 1116 | 876/876 | yes (exactly on the floor) | 200 | 0 |
| ~129% | 1115 | 875/876 | no (the floor takes over, honest horizontal scroll) | 200 | 0 |
| ~141% | 1024 | 784/876 | no (honest horizontal scroll) | 200 | 0 |

The measured flip point = between 1116/1115 (the computed value 240 sidebar + 34 px + 42 gap + 4x200 =
1116, matching to the pixel); i.e. at 1440 physical width, all four columns are visible at zoom ≤129%. The same scan before the change
(before/result.json): **every tier** ≤1440 (1309/1200/1152/1116/1115/1024)
has scroll constantly 1196 > client and the four columns constantly on the 280 floor — at 110% the 4th column is 110px off-screen,
matching the ticket's fingerprint (1196 > 1069).

## The docked state does not move (the #692 semantics identical before and after)

With ⌘J docked at 1309: before and after read **identically item by item** — cols=[280,280,280,280],
scroll 1196 > client 651, page-level overflow 0 (`before/before-docked-1309-floor-280.png`
vs `after/docked-1309-floor-280.png`). After additionally verifies the live flip: Escape closing the drawer returns immediately to
the normal geometry (scroll 1069 ≤ client 1069, cols 248.3).

## Mechanism artifact (the acceptance criterion for "the CSS takes effect")

Compiled-output grep (`grep -o` over dist/assets/*.css after `pnpm --filter @pacman/web build`):

- after: `--board-col-min:200px` + `--board-col-min-docked:280px` +
  `--board-col-min:var(--board-col-min-docked)` (the data-chief-open override rule)
  — all three forms present → `after/compiled-css-after.txt`
- before: only the single form `--board-col-min:280px` → `before/compiled-css-before.txt`

## Rerun recipe

```sh
# after (from this branch's checkout root)
node .claude/skills/verify-pacman/scripts/launch.mjs
node .claude/skills/verify-pacman/scripts/drive-1035-zoom-fit.mjs --expect=new
node .claude/skills/verify-pacman/scripts/cleanup.mjs

# before baseline (a throwaway origin/main worktree, independent ports)
git worktree add --detach /tmp/pacman-before-1035 origin/main
cd /tmp/pacman-before-1035 && corepack pnpm install
VERIFY_REPO_ROOT=/tmp/pacman-before-1035 VERIFY_PORT=8793 VERIFY_WEB_PORT=5275 \
  node /tmp/pacman-before-1035/.claude/skills/verify-pacman/scripts/launch.mjs
# the probe uses the delivery branch's copy against the before stack (--expect=old inverts the expectations):
VERIFY_REPO_ROOT=/tmp/pacman-before-1035 VERIFY_RUN_DIR=/tmp/pacman-before-1035/.claude/verify-run \
  node <delivery branch>/.claude/skills/verify-pacman/scripts/drive-1035-zoom-fit.mjs --expect=old
VERIFY_REPO_ROOT=/tmp/pacman-before-1035 \
  node /tmp/pacman-before-1035/.claude/skills/verify-pacman/scripts/cleanup.mjs
git worktree remove --force /tmp/pacman-before-1035
```

All loopback requests take `env -u http_proxy -u https_proxy -u all_proxy NO_PROXY='*'`
(the local proxy intercepts 127.0.0.1). The probe self-contains the REST bedding (a project + 4 tasks); the stack must be fresh (launch wipes the run directory each time, which satisfies this naturally).

## File index

- `after/result.json` — the 10 checks itemized + the sweep raw values (after stack 8791/5273)
- `after/*.png` — the 110%/120%/125% normal states, the 1115 boundary horizontal scroll, the ⌘J docked screenshots
- `after/compiled-css-after.txt` — the compiled-output CSS token's three forms
- `before/result.json` — 6 checks + the sweep raw values (before stack 8793/5275)
- `before/*.png` — the lesion reproduced (1309/1152 overflow, the docked contrast)
- `before/compiled-css-before.txt` — the pre-change single form 280px
