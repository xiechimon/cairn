# B2 warm-up pieces collection verification (ticket #426)

Evidence for the two strays (`overlay/token-gate.css` 30 decl + `routes/machine-authorize.css` 41 decl) after their switch to the in-repo shadcn components. The paradigm follows B1 (`docs/verify/425/README.md`).

## Evidence list

| file | content |
|---|---|
| `426-token-gate.png` | the token gate page (dark default): a full-screen black scrim + a Card panel (360 wide, centered) + title / guidance / label / input / submit button |
| `426-machine-authorize.png` | the authorize page (dark default): the canvas base fills the viewport + a Card (360 wide, centered) + title / guidance / a full-width submit button |

## Live-stack real-user path

Stack = the real `apps/server` process (PORT 8461 + `PACMAN_TOKEN` set = auth on + `PACMAN_WEB_DIR` pointing at this worktree's fixture build `apps/web/dist` + a scratch `PACMAN_HOME`, stopped right after the run, never touching `~/.pacman`).
Land on `/app` to get the gate page (triggered by the 401), then set `localStorage['pacman.token']` to pass through and go to `/app/machines/authorize` for the authorize page. Each page yields one screenshot + one computed-style/geometry reading.

| face | readings (dark default, measured on the production DOM) |
|---|---|
| gate page backdrop | `position:fixed` inset 0 (viewport 1470x705), `rgba(0,0,0,0.6)` = `--overlay-scrim`, `z-index:60` |
| gate page panel | Card→`div`: 360x223.5 at x=555 (centered), `#1f1f23` = `--card`, radius 12px, padding 24px, a ring `1px` (box-shadow oklab/0.1) + two `shadow-lg` layers |
| gate page copy | the title `h1` 16px/600/24px `#fafaf9` (--foreground); the guidance 13px/400/19.5px `#d4d4d8` (--text-secondary); the label 12px `#71717a` (--text-tertiary) |
| gate page input/submit | `ui/Input` height **36px** (unchanged), radius 8; `ui/Button` 312x32, radius 8, 13px, disabled base `--primary-disabled` |
| authorize page backdrop | `position:fixed` inset 0, `#09090b` = `--background` (the canvas's first tier, the same as board-main) |
| authorize page card | Card→`div`: 360 wide at x=555, `--card`, radius 12px, padding 24px, `gap:12px`, ring + `shadow-lg`, `role="region"` + `aria-label="授权机器"` |
| authorize page submit | **312x32 full width**, base `#4e47dd` = `--card-button` (the brand indigo retained), text `#fff`, radius 8, 13px/**500** |

The light side is measured the same way (`pacman-theme=light`), and both themes' values match the drift table below.

**The Card default-class merge fact** (against the "synthetic-markup retest" misreading): the Card carries its own
`py-(--card-spacing)` / `gap-(--card-spacing)` / `rounded-xl`, but the component merges className through `cn`
(tailwind-merge) — when `p-6` / `gap-3` / `rounded-[12px]` are passed in, **the conflicting default classes are removed wholesale**, and the production DOM's className does not contain the removed items (the measured class string proves it). The padding 24px / radius 12px / gap 12px in the table above are production readings, not a hand-sorted result of splicing two class strings on a bare element.
The two faces' gap position difference is structural: the gate page's Card has a single child (the inner `form`), and the 12px gap is carried by the form's `gap-3`; the authorize page's Card is multi-child, and `gap-3` hangs on the Card directly.

## Verification scope

- **Three gates**: `typecheck` all green; `lint` (`biome ci .`) **zero errors** — measured `Checked 444 files`,
  5 warnings + 25 infos, all baseline pre-existing (zero diagnostics on this change's files); the pre-commit hook actually ran the same chain (format --write + ci + typecheck) and passed.
  **Reading discipline**: hand-running `pnpm lint` in a Bash tool returns a **false red** "Found 2 errors" — the rtk hook rewrote the biome invocation (parses by JSON reporter, swallows output and sets a failure code; this pit is recorded in `~/.agents`). The ground truth is `rtk proxy pnpm exec biome ci .` or the pre-commit hook's verbatim execution.
- **e2e**: `token-gate` 4 + `machine-authorize` 4 + `overlay-focus` 6 + `providers-tabs` +
  `visual-polish`, **34/34 green** (E2E_PORT=8425, a single build); after the revision both faces' specs were rerun green.
- **TW utility class on-machine check**: per-item grep over the build output — every utility class added in this change is generated
  (`bg-(--overlay-scrim)`→`var(--overlay-scrim)`, `z-60`→`z-index:60`,
  `max-w-[calc(100vw-48px)]`, `rounded-[12px]`, `text-content-secondary`→`var(--text-secondary)`,
  `text-accent-rose`→`var(--rose-500)`, `break-all`→`word-break:break-all`,
  `bg-background`→`var(--background)`, etc., zero missing).
  This is the face that a class-anchor e2e **cannot catch** (the e2e still passes fully when a utility class is not generated), so it is listed separately.
- **Zero spec changes**: not a single line of the 13 class anchors in `token-gate.spec.ts` moved (the acceptance signal of alias-first #411).
- **Four-face pin check**: a whole-repo grep reconciliation across the web e2e / integration locator / visual-spec geometry assertions / value-probe four faces — the two faces have zero references in integration and visual specs (the result is an empty set, but the "checked" is recorded here).

## Re-pin list (the #411 policy-4 shape)

Source scope = the #409 three-face pin-point list; this change does not copy the appendix but re-verifies across all four faces by whole-repo measurement (grep: `token-gate*`, `authorize*`, and all `var(--…)` in both files), results below:

| pin face | type | disposition |
|---|---|---|
| the 13 spots in `token-gate.spec.ts` (`.token-gate` x5, `-title`, `-input` x2, `-submit` x2, `-error`) | class anchors | **alias retained → zero changes** |
| the non-CSS faces of `token-gate.spec.ts` (the localStorage key / `/api/teams` + the Bearer header / SSE `?token=` / `.board-sidebar`) | route / storage / network | zero changes |
| the whole `machine-authorize` site | **0 spots** (nothing in web e2e / vitest / integration / server tests) | new semantic-locator faces added (`machine-authorize.spec.ts`, policy 1 "new faces may write semantic locators directly"; the only class anchor `.authorize-backdrop` = a layout wrapper with no semantic role) |
| value probes (`getComputedStyle` / `toHaveCSS` / `boundingBox` / `toHaveScreenshot`) | **0 spots** on both faces | no re-pin needed |

**Conclusion: this change's re-pin list is an empty set** — the two faces' pins are 100% class anchors, absorbed directly by the alias-retention law.

## Pixel-impact statement (item by item)

| face | old | new | type |
|---|---|---|---|
| panel base (both faces) | `--surface` (dark #18181b / light #faf7f3) | `bg-card` (dark #1f1f23 / light #ffffff) | recipe class: B card base (+1 step) |
| panel stroke | `1px solid --border-default` | `ring-1 ring-foreground/10` (a 1px box-shadow spread) | recipe class (#139 edge ring → B card ring) |
| panel shadow | `--edge-shadow` (`0 5px 14px`) | `shadow-lg` (two TW layers) | recipe class |
| authorize page backdrop | `--surface-secondary` (dark #1f1f23 / light #f1ede7) | `--background` (dark #09090b / light #f2ede6) | recipe class: the canvas's first tier. **in dark the old value equals `--card`'s #1f1f23** — keeping it would make the panel the same color as the backdrop, separated only by a hairline ring; moving to the canvas tier opens up one step of separation (the same semantics as board-main), the light side differs by 1/255 and is invisible |
| corner radius | `--edge-radius` 12px | `rounded-[12px]` 12px | equal-value, zero-pixel (the same literal as the B-migrated faces todo-card / dialog-shell Popup; `rounded-xl` in this repo = 14px, not 12) |
| padding / gap / width / cap | 24 / 12 / 360 / `calc(100vw-48px)` | `p-6` / `gap-3` / `w-[360px]` / `max-w-[calc(100vw-48px)]` | equal-value, zero-pixel (merged through cn, production readings 24/12/360) |
| gate page backdrop | `--overlay-scrim` | the same token referenced directly (`bg-(--overlay-scrim)`) | equal-value, zero-pixel |
| title / guidance / label / error / meta | 16px600 `--text-primary`; 13px1.5 `--text-secondary`; 12px `--text-tertiary`; 12px `--rose-500` | `text-base font-semibold text-foreground`; `text-[13px] leading-normal text-content-secondary`; `text-xs text-content-tertiary`; `text-xs text-accent-rose` | equal-value, zero-pixel (the token canon's same-name same-value, production readings compared one by one) |
| authorize page submit button | scattered `padding:8px 0` + `--card-button` + weight 500 | `ui/Button primary standard` + `w-full font-medium` | equal (height ~32→32 pinned, the weight stays 500, the base color is the same `--card-button`) |

Per #411 policy 2, the four "recipe class" rows above are this change's entire visible drift; no value probes need re-pinning (0 spots on that face).

## Unmigrated-residue statement (the #421 acceptance item 5)

1. **The input**: `.token-gate-input` still walks the A3 primitive `ui/Input` (the measured 36px family) — `components/ui/` has no Input component; the input styles already live in `ui/input.css` (collected by A3), and are not in this change's two CSS files' decl counts. Adding a shared component is a separate ticket.
2. **The submit button**: both faces' submit buttons still walk the A3 primitive `ui/Button variant="primary" size="standard"` (the gate page as-is; the authorize page is collected into it from 8 scattered decls). The variant table of `components/ui/button.tsx` has no brand-primary tier — swapping to the shadcn Button would change the fill color (`--card-button` #4e47dd → the neutral `--primary`), an unrequested visual change, and would split it from the dialog family's footer buttons (still A3). The shadcn Button brand-tier ruling belongs to the rollout period.
3. **The focus recipe**: `ui/input.css`'s `.input:focus-visible` (a 1px primary stroke + a hairline ring) is not the same source as the #388 family law (2px `--focus-ring` + offset 2) — the unlayered layer always beats the `app.css` base fallback. It stays with A3 together with item 1.
4. **Adjacent-domain shared pieces**: `ui/button.css` / `ui/input.css` / `ui/card.css` are still consumed by other unmigrated domains; this change deletes and changes none of them.

## The a11y face

- The gate page's `role="dialog"` + `aria-modal` + `aria-label` moves up from the inner `form` to the Card (the panel boundary); the `form` and `type="submit"` are retained (the enter-to-submit semantics unchanged).
- The authorize page's `<section aria-label>` → the Card `div` + `role="region"` + `aria-label` (a named `section` is a region by itself, so this is a role-equivalent mapping); both pages' titles remain `h1` (not demoted to a div).

## Not covered

- **The verify-pacman standing archive was not made**: that skill's features face has no `token-gate` / `machine-authorize` paths (the current feature list does not include these two faces), and starting a formal archive requires writing a new driver first (a separate ticket). This change's evidence is instead carried by live-stack ad-hoc readings + the two specs (the gate page's API ground-truth face — 401→token→200 + the Bearer header + SSE `?token=` — is covered by `token-gate.spec.ts`'s real-server assertions); the scope and the gap are both listed here.
- **The authorize page's `confirm` failure face (`.authorize-error` + `role="alert"`) has no e2e**: it needs a stubbed 409/404 confirm endpoint; this change covers only the poll-driven four phases, and the error branch's styling is not separately evidenced.
