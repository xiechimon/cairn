# 644 · Site-wide motion migration to shadcn: prototype and trade-offs

> Status: **ruled** (2026-10-02, the user decided **direction B**: adopt shadcn defaults site-wide, explicitly overturning #73's
> replication discipline). The ruling canonical copy = `docs/adr/0009-site-wide-motion-converges-on-shadcn-defaults.md`; per-domain construction is in the execution ticket
> (ticket cites this prototype §4). This document keeps the pre-ruling inventory and A/B comparison.
> Data snapshot: `hp/pacman/t-0041-tabs` @ 2026-10-02; tw-animate-css 1.4.0 (dist read verbatim);
> reference-site measurements in `docs/verify/644/reference-measurements.md`.

## 0. Two facts that must be pinned down first

1. `apps/web/src/styles/motion.css` is an **intentional replica** of the reference site's transition registry (#73; file header
   documents values copied from the reference production stylesheet `docs/research/assets/r1/f965382e067739e9.css`).
   "Move to shadcn" is not cleanup but **revisiting an active decision** — so this doc presents directions rather than implementing.
2. `docs/spec/16-shadcn-rollout-batch-table-and-acceptance-criteria.md` **has no motion batch** (verified: §1's five batches are all
   structure/control migrations, and it states outright "per-domain migration is pure structure change, zero visual re-pinning"). Motion migration is **new scope**,
   needing the user's decision before appending a batch entry — it is not an already-scheduled item.

## 1. Current-state survey: the site already runs two motion systems side by side

### 1.1 The motion.css replication registry (#73; mechanism = hand-written keyframes + data-overlay-state manual enter/exit)

| Motion surface | Replicated value (= reference site production stylesheet) |
|---|---|
| Mount fade-in | `overlay-fade` 200ms `cubic-bezier(0,0,.2,1)` (--ease-out) |
| Overlay pop | `overlay-pop` (opacity 0→1 + `scale(.95) translateY(-4px)`→none) 150ms `cubic-bezier(.22,1,.36,1)` (--ease-pop) |
| Centered dialog | **fade only** 200ms ease-out (r8 capture measured: the opening has only an opacity animation, no zoom) |
| Drawer | `drawer-in` translateX(100%→0) 300ms --ease-pop |
| Hover family | background-color 150ms --ease-standard, `--surface-hover`, fine-pointer gated |
| Press | `opacity .85` (global buttons/links); #629 board cards = bg tint instant switch (reference site computed 0s) |
| Spinner | braille reel 900ms steps(10) (#471, kept in both directions) |
| Tab indicator bar | landed in #644: left/top/width/height 150ms `ease` (measured on todos.dev CSSTransition) |

Enter/exit mechanism: `useOverlayMount` + `.overlay-mount[data-overlay-state]` — the element stays
mounted while closed, visibility flips last (hit-test/a11y exit), and exit is driven by transition
rather than animation.

Consumers (grep verified): **14 tsx** files mount `anim-*`/`overlay-mount` classes — including three
`components/ui` adaptation layers (`dialog-shell` / `floating-shell` / `select`) and the chief /
detail / overlay / pages domains; `useOverlayMount` appears in 2 files (`overlays/dismiss.tsx` +
the hook itself).

### 1.2 The shadcn/tw-animate-css side (already in the repo, spreading with spec 16 batches)

`tw-animate-css@1.4.0` is already a web dependency; 6 tsx files already use the `animate-in`
family. The mechanism read verbatim from dist:

- `--animate-in: enter var(--tw-animation-duration, var(--tw-duration, .15s)) var(--tw-ease, ease) …`
  — **default 150ms, default easing `ease`**; enter/exit are single composed keyframes
  (opacity + translate3d + scale3d + rotate + blur all in one transform).
- Utility mapping: `fade-in-0`→`--tw-enter-opacity:0`; `zoom-in-95`→`--tw-enter-scale:.95`;
  `slide-in-from-top-2`→`--tw-enter-translate-y:-8px` (spacing 4px×2); `duration-*`→`--tw-duration`.
- Enter/exit is driven by Base UI's `data-open/data-closed`; the manual keep-alive machinery of
  useOverlayMount is **not needed**.

Current in-repo shadcn component values (read from source): `dialog.tsx`/`dropdown-menu.tsx`/`popover.tsx` =
`duration-100 fade-in-0 zoom-in-95 (slide-in-from-*-2)`; `dialog-shell.tsx` (the B1 .dlg shell) =
`duration-200 fade-in-0 zoom-in-95`.

### 1.3 Drift that has already happened (not a hypothesis — current values)

| Surface | Replication of record | Current in-repo shadcn value | Delta |
|---|---|---|---|
| Centered dialog | fade only 200ms ease-out (r8 measured) | fade + **zoom-in-95** 200ms (dialog-shell) | zoom added; easing is tw default `ease`, not ease-out |
| Overlay pop | 150ms --ease-pop, displacement **-4px** | 100ms `ease`, displacement **-8px** (dropdown/popover) | duration -50ms, easing flattened, displacement doubled |
| Mount fade-in | 200ms ease-out | (not covered by shadcn components; tw default 150ms ease) | -50ms, easing flattened |

In other words: **part of the "migration to shadcn" has already quietly happened** (components
landed by B1/B2 came in carrying shadcn default motion), and the site is currently a hybrid of
"replicated values as the base, shadcn defaults seeping into 6 components". What this ticket
must decide is precisely: which way the hybrid converges.

## 2. Two directions

### Direction A: mechanism migration with value bridging (recommended)

**Approach**: the motion carrier switches entirely to the shadcn/tw-animate-css mechanism
(`animate-in/out` + `data-open/data-closed`), but the replicated values are bridged item by item
into tw's variable layer — `duration-[200ms]`, `ease-(--ease-out)`,
`zoom-in-95 slide-in-from-top-1` (= -4px, value-for-value equivalent to overlay-pop); the manual
enter/exit of `useOverlayMount` + `.overlay-mount`/`.anim-*` retires surface by surface; motion.css
shrinks to spinner + hover/press + tab indicator bar, the state surfaces for which shadcn has no
competing mechanism.

**Look and feel**: **completely identical** to today (column 2 of the prototype is exactly this;
in the GIFs the A column is frame-for-frame equal to the "current" column) — the migration is
purely mechanistic.

**Cost** (measured against current consumers):
- Rewriting the motion classes at 14 tsx consumer points + 3 ui adaptation layers, done along
  the way in the B3/B4 per-domain batches of spec 16 (the overlay family is already B3's scope),
  **no separate site-wide change wave needed**;
- Visual e2e untouched (it pins geometry/color static states); motion-related assertions are only
  2 `getAnimations().finished` waits (mechanism-agnostic) + spinner duration (a kept surface),
  so **re-baselining cost ≈ 0**;
- One fidelity loss must be acknowledged: on the replicated reopen/exit path, opacity follows
  --ease-standard while transform follows --ease-pop (dual easing), but tw's single enter/exit
  keyframe can carry only one easing — aligning to the transform's primary easing is enough; the
  visible difference sits in the opacity curve within 150ms, negligible in magnitude but on the record.

**Fix on the side**: the three drifts in 1.3 are all reverted under A (dialog-shell drops
zoom-in-95 back to "fade only", dropdown/popover bridge back to 150ms --ease-pop / -4px).

### Direction B: adopt the shadcn default motion language directly

**Approach**: the whole site unifies on the tw-animate-css/shadcn ecosystem defaults (150ms `ease`
base tier, overlays fade+zoom-95, the already-spread duration-100 components keep their values),
**discarding the replicated values**; motion.css retires to just spinner and hover/press; the
drifts in 1.3 are not reverted but become the new canon instead.

**Look and feel**: overall faster and flatter (100–150ms, `ease`), the standard motion face of a
"generic shadcn component" site; **a site-wide perceptible drift** from the todos.dev reference
site (column 3 of the prototype).

**Cost**:
- Code volume is actually the smallest (mostly deleting classes/hooks); e2e re-baselining likewise ≈0;
- The real cost is at the **decision layer**: it overturns #73's replication discipline ("values
  copied item by item from the reference site") and maximizes the tension with the positioning
  ruling of #515 ("semantic-axis alignment with todos") — motion is part of the reference site's
  look, so giving the whole site's motion a new face amounts to declaring that the visual layer
  no longer aligns with the reference site. This step **can only be ruled by the user**; it must
  not happen as a side effect of a migration (and 1.3 shows it is currently happening as a side effect).

### Items common to both directions (unchanged by direction)

- Tab indicator bar (#644), spinner reel, hover/press tint: shadcn has no competing default, both
  directions keep current values;
- The `prefers-reduced-motion` degradation rule is kept in both directions;
- Scheduling shape: both recommend appending a "motion batch" entry to spec 16 — **woven into the
  B3/B4 per-domain work** (each domain's motion is collected while that domain's structural
  migration happens), not a separate site-wide wave; acceptance reuses that volume's §2 template +
  this prototype's GIFs as before/after reference objects.

## 3. How to use the prototype

- **Interactive prototype**: open `docs/research/assets/644/motion-prototype.html` directly in a
  browser — 5 motion surfaces × 3 columns (current / A / B) auto-cycle, with a "replay all"
  button; each cell is annotated with the real class names and values. The timeline is driven by
  the Web Animations `currentTime`, so interaction and screenshots follow the same deterministic path.
- **Per-surface GIFs** (this directory; the PR body embeds the same set): `motion-pop.gif` /
  `motion-dialog.gif` / `motion-drawer.gif` / `motion-fade.gif` / `motion-pill.gif`; overview
  still frame `motion-board.png`. Note that the A column being **frame-for-frame equal** to the
  "current" column is deliberate — it demonstrates "the mechanism changed, the look did not".

## 4. Decision (2026-10-02, user ruling)

1. **Direction = B** (adopt shadcn defaults site-wide, explicitly overturning #73's replication
   discipline — rationale and boundaries in ADR 0009; this document's recommendation for
   direction A was not adopted).
2. **The three existing drifts in 1.3 are ratified one by one under B** and not ruled on
   separately: the dialog's zoom-in-95, the dropdown/popover 100ms/-8px, and mount fade-in falling
   to the tw default tier all become the new canon.
3. **Scheduling = the motion batch is woven into spec 16's B3/B4 per-domain work**; implementation
   tickets are organized per domain, and #644 itself ends at prototype delivery (closed with PR #648).
