# #949 overlays/ domain construction — verification evidence

Ticket: #949 (#908 wave 2 · the overlays/ directory family, running in parallel with the overlay/ directory ticket #948, bounded by directory). This directory = the artifacts for three of the acceptance's seven items — "probe re-pin", "better-colors measurement", "verify-pacman evidence archive" — plus the equivalence-migration parity human-review record.

## Contents

| path | content | acceptance item |
| --- | --- | --- |
| `parity-949.md` | the equivalence-migration human-review table: before (origin/main 034bf7d5 throwaway worktree stack) × after (this branch's stack), 283 scalars per theme across both themes; every DRIFT falls into one of the four authorized classes CANON / CANON-SWAP / CARRIER / ACCEPTED, **zero UNCLASSIFIED** | 2 |
| `parity/*.json` | the four parity collection originals (before/after × light/dark) | 2 |
| `probe-parity.mjs` | the parity collection script (40 measurement faces: panel box/row box/hover/selected/kbd yield/scrim/pill dimming/popover anchoring/Arrow/catcher/full-state menu rows); `--carrier after` switches the semantic carrier, `--scheme` switches the theme | 2 |
| `probe-dump/probe-comparison.md` | the #921 tool comparison table (12 re-pinned specs, 47 visual rows): **KEPT 47 / DRIFT 0 / VIOLATION 0 / NOT-RUN 0** | 2 |
| `probe-dump/probe-dump.json` | the structured full dump (sites/values/rows) | 2 |
| `contrast-949.md` | better-colors dual-theme 27-pair gated measurement table (rendered pairs + token-resolved pairs, WCAG 2.x formula): **0 failures**, domain minimum 4.5:1; includes the `--text-dim × --popover-bg` three faces caught by measurement and slot-swapped (light 2.89 < the slot floor 3 → `--text-tertiary`, authorized by #908 ruling 2, token values untouched); the report-only soft hairline 3 pairs match the §1.7/1.8 table values digit by digit | 3 |
| `live-stack/` | custom probe (`drive-949-overlays.mjs`, enters `.claude/skills/verify-pacman/scripts/` with this PR): A ⌘K panel real path 9 items (geometry/skin/row-button collection/hover pill/keyboard cursor data-selected/StatusChip sm/always-lit mutual-exclusion dimming law/scrim click-to-close/exit transparency monotonicity) + B chip popover real path 7 items (anchoring geometry/V2 shell+Arrow/ClickCatcher collection/data-selected section/row hover tint/edit-assignment neutralization/Esc layering) + D mechanism 2 items (zero rules for retired selectors/dimming utility present) + E contrast dual-theme 2 items = **38 checks all PASS, failures 0** (both themes); screenshots 01/02/03/05 + `result.json` + `contrast.json` | 3, 4 |
| `build-artifact-grep.txt` | compiled-artifact mechanism evidence: grep over the dist of `vite build --mode fixture` — the 18 retired selectors have **zero rules**; the surviving class-name faces match the report (`.doc-select-wrap` css 1 = the detail.css sibling-selector live address, `.doc-pane-select` css 5 = the #945 ledger, sidebar/rail aliases are JS class strings only); the new carriers (data-row-kind / data-selected / chip-chevron / html[data-search-open] utility) are all present | 4, 5 |
| `local-full-e2e.log` | acceptance item 1 "one local full run before merge" artifact: full e2e on the final code (E2E_PORT=8402) **809 passed (1.8m)** full log | 1 |
| `local-full-e2e-merged.log` | the full rerun on the merged head after merging origin/main (#947 landed): **809 passed (3.9m)**; the same head's web unit 446/446, integration 60/60 | 1 |

Section C (plan dropdown) live-face declaration: the type-picker hangs on the doc face of the detail right pane, and reaching it on the live stack needs build payload data (the daemon + LLM full chain) — this probe explicitly declares that face's live walkthrough skipped; the coverage = fixture e2e (detail-3pane / dead-buttons §6 / m7-branch-dialog integration, all green) + the parity probe's full-state menu rows (including hover/focus/checked composite states, KEPT in both themes).

## Reproduction

```sh
# parity (two throwaway fixture stacks, pick the ports, lsof-recheck before starting)
git worktree add --detach /tmp/pacman-before-949 origin/main
(cd /tmp/pacman-before-949 && corepack pnpm install \
  && cd apps/web && pnpm exec vite build --mode fixture \
  && pnpm exec vite preview --port 8405 --strictPort &)
(cd apps/web && pnpm exec vite build --mode fixture \
  && pnpm exec vite preview --port 8406 --strictPort &)
node docs/verify/949/probe-parity.mjs --url http://localhost:8405 --out /tmp/before.json
node docs/verify/949/probe-parity.mjs --url http://localhost:8405 --scheme dark --out /tmp/before-dark.json
node docs/verify/949/probe-parity.mjs --url http://localhost:8406 --carrier after --out /tmp/after.json
node docs/verify/949/probe-parity.mjs --url http://localhost:8406 --scheme dark --carrier after --out /tmp/after-dark.json

# probe comparison table (#921 tool; call node directly — pnpm forwards the `--` verbatim and trips unknown flags)
cd apps/web
node e2e/probe-dump.mjs --specs search-focus search-result-rows search-close-flash \
  chip-hotzone chip-assign detail-esc avatar-dicebear detail-3pane dead-buttons \
  hotkeys escape-wiring sidebar-search-offboard \
  --out ../../docs/verify/949/probe-dump

# live stack (if the default ports are taken, move along — see the skill's port discipline; this lane measured 8791/5273 held by a neighbor and moved to 8795/5277)
VERIFY_REPO_ROOT=<worktree> VERIFY_PORT=8795 VERIFY_WEB_PORT=5277 \
  node .claude/skills/verify-pacman/scripts/launch.mjs
VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-pacman/scripts/drive.mjs new-task
VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-pacman/scripts/drive-949-overlays.mjs
VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-pacman/scripts/cleanup.mjs
```

## Scope notes

- Contrast floors: text 4.5, non-text UI 3.0 (better-accessibility); the `--text-dim` slot's canon floor 3 is the on `--background` pair (§1.7/1.8's 3.75/3.05) — pressed onto the popover base (brighter) it measured 2.89 and broke the floor — the consumer-face slot swap follows the same disposition as the #943 notify-banner precedent.
- The report-only family (spec/22 §1.3): the soft hairline `--overlay-divider`/`--card-border`/`--border-default` three pairs report numbers without red judgments; the measured values match the §1.7/1.8 table columns digit by digit (dark 1.11/1.11/1.2, light 1.06/1.06/1.12).
- The D1 mechanism scan walks the stylesheet rule enumeration (including @media/nested descent; a CSSStyleRule's empty cssRules must not be descended into or every selector is missed — this lane hit that on the first round, the script is fixed).
- Two Base UI Menu carrier facts (measured during re-pinning): ① the popup's accessible name is bound by `aria-labelledby` to the trigger button (overriding `aria-label="面板视图"`), so the spec pins a bare `getByRole('menu')` (an open menu is always unique); ② hovering inside a menu moves focus, so the hover tint must carry a `hover:focus:` composite tier to beat the component base's `focus:bg-*` neutralization class (the pre-migration measured order: hover beats checked/focus).
- While a modal panel is open, Base UI puts `aria-hidden` on the background: the dimmed-page pill's assertions under the scrim must use `getByRole('complementary', { includeHidden: true })`, otherwise the role engine filters the landmark out entirely (the old CSS-class locator had no such filter; carrier equivalence is preserved by this switch).
