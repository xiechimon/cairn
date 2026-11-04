# 16 · shadcn/ui Site-Wide Rollout: Batch Table and Acceptance Criteria

> **superseded-in-part (2026-10-05, ADR 0010 / #908)**: this volume is partially replaced by the four rulings of the site-wide UI overhaul; the original text is kept wholesale as the historical ledger, not deleted. Voided surfaces: ① the header's "pixel discipline" note (per-domain migration is pure-structure, zero visual re-pin, per-face rules are the geometry and color canon) — retired, replaced by hue re-selection + free geometry redesign + migrating all per-face CSS to Tailwind to zero (ADR 0010 D1–D3); ② the cited #411 "class-name alias preservation as the site-wide law" and #421 acceptance-template item 3's "visual probe re-pinned per B" execution caliber — replaced by the semantic-first two-tier system + re-pin-with-the-change (ADR 0010 D5, ruling source = the #910 decision); ③ the batch table (§0/§1) and the per-slice acceptance standard template — per-domain batches and acceptance template v2 re-issued by #913; ④ all measured numbers frozen at `fa54bbad` — before construction, take #908 Notes' 2026-10-05 baseline (`67509706`) as authoritative. New canon pointer: `docs/adr/0010-site-wide-ui-overhaul-free-redesign-of-hue-and-geometry.md`, #912 token canonical table, #909 finalized palette (`library/t-0909/src/themes/c.css` @ `7340d0ab`).

> Canonical status: this volume collects #417 (Map)'s three planning products — the **batch table**, the **per-slice acceptance standard template**, and the **dependency order against the three blueprint tickets** — and pins the two measured ledgers "landed / frontier" in one place, so B3 / B4 execution tickets do not need to flip back through issue threads for the caliber.
> Ruling source: #421 (batch table and acceptance caliber, 2026-09-29 user full agree), #422 (first slice chosen, 2026-09-29), #409 (migration-surface inventory, 2026-09-29); the three blueprint tickets = #410 (primitives selection) / #411 (e2e re-pin caliber) / #412 (token pipeline).
> Time-effectiveness: §5 measured against `origin/main @ fa54bbad` (2026-10-01, the XMON-20 sampling point), command by command in §7; #409's numbers taken at `8c30775`, any different unit or drifted spot annotated in place.
> Batch-assignment caliber (XMON-17 fixed, XMON-20 added the second edge): **every `ui/` primitive consumption point and every handwritten control must fall in some batch**. Ruling A2=B (parent ticket XMON-3): the `routes/` and `board/` remnants split back into the existing batches by domain, no new "routes batch"; domain is decided by two re-checkable edges — **which shell is mounted** (`resources/shell.tsx` / `secondary/shell.tsx`) and **which domain css is directly imported**. The written-control admission caliber (bare `<button>` / `<input>` / `<select>` / `<textarea>`) sees §6.5 — under the old "does it import a `ui/` primitive or not" caliber they are the only under-counted class.
> Pixel discipline: per-domain migration is a **pure-structure** change, zero visual re-pin (the #411 policy 4 + #435 value-canon convergence caliber) — per-face rules remain the geometry and color canon, swapping components to shadcn only swaps the carrier structure.

## 0. Conclusions Overview

| Batch | Content | Status (fa54bbad measured) |
|---|---|---|
| **#414 pilot slice** | board / sidebar domain (board / sidebar) | **primitive surface closed** (#561: `board/notify-banner.tsx` switched to the `components/ui` Button, primitive consumption points zeroed, see the §5.2 re-run record); 13 bare controls untouched (sidebar 9 etc.), see §6.5 |
| **B1 overlay-family slice** | 19 mount points folded into shadcn Dialog | landed (#425, evidence `docs/verify/425/`) |
| **B2 warm-up slice** | token-gate + machine-authorize + secondary surface | **landed** (#426 warm-up two surfaces, evidence `docs/verify/426/`; Button/Input wrap-up XMON-13 / #534; secondary surface XMON-20, evidence `docs/verify/xmon-20/`) |
| **First real-domain slice** | resources five pages (machines / providers / secrets / skills / mcp-servers) | landed (#423, evidence `docs/verify/423/`); `routes/agent-detail.css` is an in-shell neighbor-page remnant, see §6.2 |
| **B3 overlay-content family** | overlays + overlay + detail/overlays + mention-picker | **not started**, 3 tsx consumption points left; 26 bare controls / 22 handwritten classes |
| **B4 the tall three** | chief / detail / pages | **not started**, 11 tsx consumption points left; 83 bare controls / 59 handwritten classes |

Gate status: the three blueprint tickets **#410 / #411 / #412 all CLOSED** (#412's execution ticket #435 also closed), B1 also landed — the two gates #421 set ("B2 onward blocked-by #412 + #411" and "B1 serial-first") **both open**, B3 / B4 can start directly.

## 1. Batch Table

The first four rows are the #421 ruling verbatim (numbers are the #421-point values); the **`#414 pilot slice` row and the [batch increments] at each row's end are XMON-17's per A2=B** — added so every `ui/` primitive consumption point can point to a batch.

| Batch | Content | Basis | Parallel | Bare controls |
|---|---|---|---|---|
| **#414 pilot slice**[batch increment] | board / sidebar domain (`board/`)'s **full primitive switch** — #414 only migrated the card family's tokens and utility classes, the primitive consumption points remain; `routes/board-page.tsx` same domain (directly imports `board/board.css`) | this slice was the earliest to land, the domain exists; a remnant not batch-assigned never has an acceptance scope | already on the board, this batch only closes | 13 |
| **B1 overlay-family slice** | 19 mount points (shared shell 14 consumption points + 2 handwritten shells) folded into shadcn Dialog; the shell class `.dlg` ×67 is the hottest re-pin single point | shared components first, avoiding a half-migration seam repeated in every domain | **serial first** | 0 |
| **B2 warm-up + first real-domain slice** | token-gate (30 decl) + machine-authorize (41 decl) + one of resources / secondary (#422 ruled = resources). [batch increment] **secondary surface**: the three page shells under `routes/` + the same-domain pages `team-page.tsx` / `team-chart.tsx` / `account-page.tsx` (all mount `secondary/shell.tsx`, styles injected through `secondary.css`; precedent = XMON-13 already landed the same-domain `routes/machine-authorize-page.tsx` per this row) | the low 2 surfaces small with few pins; the medium 9's two shells singly imported, the boundary cleanest | within-batch cross-domain parallelizable | 30 |
| **B3 overlay-content family** (merged one slice) | overlays (241) + overlay (278) + detail/overlays (404) + mention-picker (223, fix the dangling token first) | three same-family (dlg-* content family), cross-domain same-source; merging avoids changing the dialog-viewport 34 pins three times | within-batch parallelizable | 30 |
| **B4 the tall three** | chief (464 / 49 pins) + detail (852 / 41K single file) + pages (899 / prj-* 42 selectors) | volume and pin density decide it must wait for the pipeline and re-pin caliber to stabilize | parallelizable, **max two lanes** (avoid same-batch assertion conflicts) | 102 |

The "**bare controls**" column caliber = the sum of the four bare `<button>` / `<input>` / `<select>` / `<textarea>` (the whole-domain measurement and per-file ledger see §6.5). Values taken on the **post-XMON-20** tree: five batches total 175 + the `ui/` primitive body itself 2 = site-wide **177** (`fa54bba` baseline 188); the B3 row includes `detail/overlays.tsx` (with the corrected edge per §6.2 it belongs to B3). The B2 row dropping from 41 to 30 is the 11 this ticket migrated away.

`board/` / `sidebar` are **not** in the "eliminated from the board" column: there are still primitive consumption points measured (§5.2), assigned to the `#414 pilot slice` for closure; the `routes/` eight tsx split into `#414 pilot slice` / `B2` / `first real-domain slice` by the two edges above (which shell / which domain css), no separate batch. The ruling and evidence see §6.2.

**Motion batch (#656 / ADR 0009, woven into B3/B4, no separate site-wide wave)**: the site-wide enter/exit motion converges from #73's motion.css replication registry to shadcn / tw-animate-css defaults (direction B, the user 2026-10-02 ruled; explicitly revoking #73's replication discipline on the **motion-value surface**, the geometry/color pixel discipline unchanged). Mechanism = `animate-in` / `animate-out` + Base UI `data-open` / `data-closed` driving — popups whose panel is themselves (`.dlg` / alert-dialog shell) use their own `data-open:`; popups that are a wrapper layer with the panel a fixed/absolute child (FloatingShell family / viewport root surface) mount `group` on the popup and the child panel goes through `group-data-open:` / `group-data-closed:` (a wrapper with a transform drags away the fixed child's containing block, so the motion lands on the child not the shell). `useOverlayMount` / `.overlay-mount` / `.anim-*` manual keep-alive retires with the last consumption surface. The per-domain scope of the 14 consuming tsx weaves into B3/B4 — each domain's structure migration collects that domain's motion in passing; the first PR lands the tw-animate-css wiring (`app.css`'s `@import`, previously only a dependency never wired, the `animate-in` family not generated) + this entry. Acceptance follows this volume's §2 template + #656 ticket F4's motion assertion list: `anim-fade|anim-pop|anim-drawer|overlay-mount|useOverlayMount` grep to zero in `apps/web/src/**/*.tsx`, motion.css shrinks to the D4 kept surface (spinner reel / hover-press / global `:active` / reduced-motion degradation rule), the D3 three ratified values (dialog `zoom-in-95`, dropdown/popover `duration-100` + slide -8px, mount fade-in goes to the tw default tier) verbatim, the kept-surface contract (segmented pill 150ms ease verbatim, spinner-live duration) all green, e2e assertion changes = 0.

## 2. Per-Slice Acceptance Standard Template (#421 ruling verbatim)

1. that domain's interface **fully switched to shadcn components** (including that domain's overlay content family, if any);
2. that domain's **behavior e2e all green** (fixture-surface regression goes through apps/web e2e, not verify-pacman);
3. **visual probe re-pinned per B** (caliber under #411; the re-pin list excerpted from #409 Appendix A by spec — that appendix already merged into main, but numbers frozen at `8c30775`, re-run per §6.4's caliber before excerpting the list);
4. **verify-pacman stack produces evidence** (screenshots + API/SQLite) archived into `docs/verify/<ticket>/` committed with the PR;
5. **unmigrated remnant declaration**: the deliberately-kept-old surfaces of this slice (neighboring-domain shared components etc.) listed in the PR body, avoiding the "looks fully migrated" illusion.

**Per-slice specific extra surfaces** (#421 only named the volume and pin density; supplementary by domain before start):

- B3: `dialog-viewport`'s 34 pins are a cross-three-domain same-source surface — merging into one slice is exactly to fix it once; `mention-picker`'s 5 dangling tokens already fixed by #419 (PR #427), this slice does not need to redo it.
- B4 · chief: 49 pins + the container structure will change (docked right rail, ADR 0004 / #447) — **#447 merges before B4**, B4 migrates the rail, not the inset floating card.
- B4 · detail: `todo-detail-page.tsx` 41K single file is the largest single point, the domain css now 955 decl (§5.1).
- B4 · pages: the domain css now 1094 decl (§5.1), the largest household.

## 3. Gates and Dependency Order (#421 ruling verbatim)

- **B2 onward all execution tickets blocked-by #412 (token pipeline) + #411 (e2e re-pin caliber)**; #420's **design** sets no gate (facts already ready), B1's **execution** sets the gate.
- #419 (mention-picker dangling token fix) unblocked, doable anytime.
- B1 serial first; B2 onward within-batch cross-domain parallelizable, each its own worktree + **private E2E_PORT** (8399 occupied silently runs on another build — #414 measured).
- #410 (primitives selection) decoupled from rollout: ruled **base (Base UI, `@base-ui/react`)**, B1 onward all shadcn components pulled in base shape.

**Current status**: the #412 + #411 + B1 three gates all released, B3 / B4 no blocking prerequisite.

## 4. Landed Batches and Evidence

| Slice | Landed content | Evidence archive |
|---|---|---|
| B1 (#425) | the overlay-family shared shell switched to Base UI Dialog; `ui/dialog-shell.tsx` deleted, 11 consumption points only changed import paths, call sites zero change | `docs/verify/425/` |
| B2 (#426) | token-gate / machine-authorize panels switched to Card + semantic tokens | `docs/verify/426/` |
| B2 wrap-up (XMON-13 / #534) | the same two surfaces switch again to `components/ui` Button + Input (`overlay/token-gate.tsx` 24 lines + `routes/machine-authorize-page.tsx` 21 lines) | `docs/verify/xmon-13/` |
| First slice (#423) | resources five pages: Card folds in the `res-card` / `res-rowcard` / `res-model-row` family, Badge folds in `res-pill` / `res-tag`, new registry components tabs / switch / input / empty; the domain's 3 DialogShells go to B1 | `docs/verify/423/` |
| B2 · secondary surface (XMON-20) | `routes/` three secondary page shells + same-domain pages `team-page.tsx` / `team-chart.tsx` / `account-page.tsx`, 6 files total, switched to `components/ui`: 11 bare `<button>` folded into Button (the layout-switch tab / create-Agent slot ×2 / language trigger and option row / new secret / copy / create / cancel / select-all clear / popover submit) + the push-notification button switched to Switch; 3 files' `ui/` primitive consumption points (button ×2, input ×3) zeroed, `ui/dialog.css`'s form family and `secondary.css`'s per-face rules kept verbatim as the geometry canon | `docs/verify/xmon-20/` |

The three slices' common acceptance signal: **the e2e spec asserts one line unchanged** (the alias-first policy #411's acceptance signal).

Also one prerequisite belonging to no slice: **the three-primitive landing spot (XMON-14 / #535)** fills `components/ui`'s avatar / kbd / tag-chip and two adapter layers, and switches 21 consumption surfaces at once (evidence `docs/verify/xmon-14/`) — it lands "components", not "domains", so it does not enter the table above, only rewrites §5.2's reading.

## 5. Frontier Measurement (baseline fa54bbad)

### 5.1 Domain css volume

Caliber note: #409 reported `326` (resources.css) as **decl count**, #422 already corrected it; the table below uses decl count too, line counts given separately for cross-check.

| Domain css | lines | decl | rule | #409 baseline (decl) | Owning batch |
|---|---|---|---|---|---|
| `pages/pages.css` | 1927 | 1094 | 221 | 899 | B4 |
| `detail/detail.css` | 1913 | 955 | 227 | 852 | B4 |
| `secondary/secondary.css` | 924 | 488 | 113 | — | B2 · secondary surface (XMON-20 landed) |
| `chief/chief.css` | 841 | 470 | 96 | 464 | B4 |
| `detail/overlays.css` | 771 | 420 | 95 | — | B3 |
| `resources/resources.css` | 680 | 363 | 79 | 326 | landed (first slice #423) |
| `overlays/overlays.css` | 462 | 238 | 53 | — | B3 |
| `overlay/overlay.css` | 459 | 240 | 48 | — | B3 |
| `overlay/mention-picker.css` | 410 | 227 | 51 | — | B3 |
| `routes/agent-detail.css` | 379 | 185 | 47 | — | first real-domain slice (in-shell neighbor page: `routes/agent-detail-page.tsx` mounts `resources/shell.tsx`; see §6.2) |
| `board/board.css` | 140 | 64 | 13 | — | #414 pilot slice |
| `ui/*.css` (primitives 5 pieces) | 441 | 189 | 57 | — | retires with the consumption points; `dialog.css` exception — the `.dlg-*` alias rules still output by B1's new shell, this slice untouched |

Difference vs c95ee5f: `detail/overlays.css` 745/407/92 → 771/420/95, `routes/agent-detail.css` 343/175/42 → 379/185/47, `detail/detail.css` lines 1912 → 1913, all the post-#435 / #474 / XMON-13 / XMON-14 volumes; the primitive css dropped from 7 to 5 pieces (`ui/tag-chip.css`, `ui/kbd-hint.css` deleted with XMON-14's landing spot).

Unit reminder: #409's original words reported decl count for resources.css (#422 already corrected it), but "lines" for the tall three — the two units are inconsistent, the table's 5th column is only a **reported value**, not a difference interpretation. What is comparable is the measured value under the same unit: the tall-three order unchanged (pages > detail > chief), but all three volumes grew by decl (+195 / +103 / +6) — **B4's pre-start "per-domain dedicated decisions" must redo reconnaissance per the new volume**, not reuse #409's absolute values for scheduling.

### 5.2 Files still consuming `ui/` primitives (16 files / 17 spots)

Caliber: only counts imports of the `from '../ui/<p>.js'` shape (including the `type` shape, marked). The real consumption points of `ui/card`, `ui/dialog-shell` are all **0** now (`ui/dialog-shell.tsx` deleted with B1; `ui/card.tsx` a dead primitive since #409). `ui/avatar` / `ui/tag-chip` / `ui/kbd-hint` zeroed respectively after XMON-14 (#535) landed, landing spot sees §6.1. The third column only counts `components/ui/` imports, incl. XMON-14's three new adapter layers (`seeded-avatar` / `kbd-hint` / `tag-chip`). **Every row of this table points to a batch** (XMON-17 caliber).

| Owning batch | File | Still consumes `ui/` primitive | Already consumes `components/ui/` |
|---|---|---|---|
| B3 | `overlay/new-task-dialog.tsx` | `ui/button` | `dialog-shell` |
| B3 | `detail/overlays.tsx` | `ui/button` | `seeded-avatar` |
| B3 | `overlays/search-panel.tsx` | `ui/input` | `dialog-shell`, `seeded-avatar` |
| B4 | `chief/chief-drawer.tsx` | `ui/button` | - |
| B4 | `chief/chief-settings.tsx` | `ui/button` | - |
| B4 | `detail/accept-dialog.tsx` | `ui/button` | `dialog-shell` |
| B4 | `detail/branch-dialog.tsx` | `ui/button` | `dialog-shell` |
| B4 | `detail/dhead.tsx` | `ui/button` · `ui/chip` | `floating-shell` |
| B4 | `detail/review-dialog.tsx` | `ui/button` | `dialog-shell` |
| B4 | `detail/source-issue.tsx` | `ui/button` | - |
| B4 | `pages/github-issues-dialog.tsx` | `ui/button` | `dialog-shell`, `tag-chip` |
| B4 | `pages/project-page.tsx` | `ui/button` | `seeded-avatar` |
| B4 | `pages/project-settings-page.tsx` | `ui/button` | - |
| B4 | `pages/schedules-page.tsx` | `ui/button` | - |
| first slice done | `resources/create-provider-dialog.tsx` | `ui/input` | `dialog-shell` |
| first slice done | `resources/create-secret-dialog.tsx` | `ui/input` | `dialog-shell` |

By primitive summary: `ui/button` ×13 · `ui/input` ×3 · `ui/chip` ×1.

Difference vs c95ee5f (36 files / 46 spots → 17 files / 18 spots, −19 / −28):

- **−21 spots** = the three-primitive consumption points, XMON-14 (#535) switched at once after landing (avatar 12 / tag-chip 6 / kbd-hint 3);
- **−3 spots** = `overlay/token-gate.tsx` (button + input) and `routes/machine-authorize-page.tsx` (button), XMON-13 (#534) B2 wrap-up switched;
- **−4 spots** = the secondary-surface three files (`routes/api-keys-page.tsx` button, `routes/api-key-create-dialog.tsx` button + input, `routes/create-agent-dialog.tsx` input), XMON-20 switched — B2 · secondary surface zeroed with this;
- XMON-17 only batch-assigned the then-remaining 20 files / 22 spots row by row (no code change); after XMON-20 landed it refreshed to 17 files / 18 spots; #561 then migrated `board/notify-banner.tsx`'s one spot away (#414 pilot slice primitive consumption points zeroed) — today 16 files / 17 spots.
- `detail/overlays.tsx`'s owning batch corrected from B4 to **B3**: its domain css is `detail/overlays.css` (§5.1 belongs to B3, overlay-content family), the original table placing it under B4 by directory was misplaced.

## 6. The Four Pre-Start Items' Landing Spots (all landed)

All four had their options fixed in the 2026-09-30 parent-ticket ruling and each landed: 6.1 = A1 (add three, XMON-14 / #535), 6.2 = A2 (split back to existing batches by domain, this ticket), 6.3 = A3 (B2 wrap-up, XMON-13 / #534), 6.4 = A4 (base ledger merged to main, XMON-11 / #532).

### 6.1 The three primitives' landing spot in `components/ui` (landed)

Original state: `components/ui/` has no avatar / tag-chip / kbd-hint among its existing components, the 21 consumption points (`avatar` 12 / `tag-chip` 6 / `kbd-hint` 3) cannot reach the "fully switched to shadcn components" acceptance.

**Ruling A1 = A (add three)**, XMON-14 (#535) landed: `components/ui/avatar.tsx` + `kbd.tsx` pulled the base-nova registry components verbatim into the repo (in-repo deviations annotated in place: Avatar Root drops the `after:` ring, AvatarImage drops size and radius — geometry goes to the per-face canon); `seeded-avatar.tsx` / `kbd-hint.tsx` / `tag-chip.tsx` are in-repo semantic adapter layers (tag-chip lands on the existing `badge.tsx`, the registry has no same-name component, continuing #423's `res-pill` / `res-tag` → Badge precedent). The 21 consumption surfaces only change import paths and component names, call-site arguments zero change; `ui/{avatar,kbd-hint}.tsx` and `ui/{tag-chip,kbd-hint}.css` deleted with it.

Result: §5.2's three-primitive rows zeroed, `ui/*.css` dropped from 7 to 5 pieces (§5.1).

### 6.2 `routes/` and `board/` batch assignment (ruled, this ticket landed)

**Ruling A2 = B**: split back into existing batches by domain, no new "routes batch".

Domain assignment uses two **re-checkable edges**, not directory names:

1. **which shell is mounted** — `resources/shell.tsx` (resources domain) / `secondary/shell.tsx` (secondary domain). The pages under `routes/` import 0 css themselves, styles all injected through the shell's domain css.
2. **which domain css is directly imported** — `routes/board-page.tsx` → `board/board.css`, `routes/agent-detail-page.tsx` → `routes/agent-detail.css`, `routes/todo-detail-page.tsx` → `detail/detail.css`.

Landed in the batch table (§1):

| `routes/` file | Domain (edge) | Owning batch |
|---|---|---|
| `api-keys-page.tsx` · `api-key-create-dialog.tsx` · `create-agent-dialog.tsx` | secondary (all mount `SecondaryShell`; `create-agent-dialog` rendered by the same-domain `team-page.tsx`) | B2 · secondary surface (XMON-20 landed) |
| `agent-detail-page.tsx` (+ `agent-detail.css`) | resources domain (mounts `ResourceShell`, route-level directly imports `agent-detail.css`) | first real-domain slice (in-shell neighbor page, css is a remnant; §6.5 records 6 bare controls) |
| `board-page.tsx` | board domain (directly imports `board/board.css`) | #414 pilot slice (§6.5 records 1 bare control) |
| `team-page.tsx` · `team-chart.tsx` · `account-page.tsx` | secondary | B2 · secondary surface (XMON-20 landed; §5.2's recorded "no primitive consumption point" is only the primitive ledger, the bare-control ledger is in §6.5: this ticket migrated 11 away) |
| `machine-authorize-page.tsx` | machine-authorize | B2 (XMON-13 / #534 landed) |

The `board/` side same rule: `board/notify-banner.tsx` → **#414 pilot slice**. And correct the old ticket record — **#414 migrated the card family's tokens and utility classes, not a full primitive switch**; that tail already closed by #561 (notify-banner switched to the `components/ui` Button, primitive consumption points zeroed), but `sidebar`'s 9 bare controls remain (§6.5), per §6.5's "full control switch" it is not complete, `board/` / `sidebar` still not in the "eliminated from the board" column.

The two decisions are not missing components but ownership correction: `routes/agent-detail.css` and the `routes/` three secondary page shells each point to a batch, the `board/` remnant returns to its own domain.

### 6.3 B2 two surfaces' Button / Input wrap-up (landed)

Original state: `overlay/token-gate.tsx`'s header-stated keep-reason verbatim was "components/ui has no Input component, shadcn Button's variant table has no brand primary tier, swapping changes the fill color — so this slice does not touch them". Both are **overturned by later batches**: `components/ui/input` entered the repo later (#423), `components/ui/button` added a `brand` tier in #423 (comment verbatim: "= the track-A3 ui/Button primary-tier equivalent migration slot"). `routes/machine-authorize-page.tsx` same shape (`ui/button`, Card already switched).

**Ruling A3 = A (B2 wrap-up)**, XMON-13 (#534) landed: the two surfaces switched to `components/ui` Button + Input (change surface = `overlay/token-gate.tsx` 24 lines + `routes/machine-authorize-page.tsx` 21 lines, evidence `docs/verify/xmon-13/`). Both their domain css retired one step earlier — `overlay/token-gate.css` and `routes/machine-authorize.css` deleted with the B2 warm-up slice (#426 / #474, commit `aa1314b`). §5.2's these two rows zeroed.

### 6.4 #409's re-pin base ledger (merged to main, numbers frozen at `8c30775`)

Per-slice acceptance item 3 needs to "excerpt the re-pin list from #409 Appendix A by spec". That base ledger is `docs/research/migration-surface.md` (Appendix A/B: the 46+3 specs' per-file selector full tables), originally only on the `research/migration-surface` branch (commit `def4b57`).

**Resolved**: per the parent-ticket ruling A4=A, that file merged into `main` — the body taken verbatim from `def4b57`, the file header records the source and the merge reason.

**But re-run before excerpting the list**: the report was written at `8c30775`, and at merge time the deviation against the current tree was already computed (re-check baseline `9a0613b`, 77 commits later), inserted **in place** as "deviation annotation" blocks in the report's sections. **Appendix A's 46-spec full table is not the current list** (now e2e 66 specs / 61 with class-name pins; the per-row count and distinct in the table may have changed); §3.1, §2.1, §4 the same. Read the corresponding section's annotation block before excerpting any number.

Same-kind research products still not on `main`: `research/dialog-contract` (#418), `research/baseui-dialog-contract-2` (#430 lane) and other branches same shape.

### 6.5 Ledger gap: handwritten controls not in the account (XMON-20 supplement)

**Problem**: §6.2's batch-assignment caliber only recognizes **"does it import a `ui/` primitive or not"** one edge. So a file that "imports no `ui/` primitive and handwrites all buttons as bare `<button>` + one-off class names" gets recorded as "**this time no primitive consumption point**" — the ledger clean, but it is exactly the surface that most needs shadcn-ification.

**Example** (the user called it out while looking at the serve-live app): §6.2 recorded `team-page.tsx` / `team-chart.tsx` / `account-page.tsx` three as "B2 · secondary surface (this time no primitive consumption point)", but measured:

| File | bare `<button>` | `ui/` primitive import |
|---|---|---|
| `apps/web/src/routes/team-page.tsx` | 3 (top grid / org-chart switch ×2 + create Agent ×1) | 0 |
| `apps/web/src/routes/team-chart.tsx` | 1 | 0 |
| `apps/web/src/routes/account-page.tsx` | 3 | 0 |
| `apps/web/src/routes/api-keys-page.tsx` | 1 | 1 |
| `apps/web/src/routes/api-key-create-dialog.tsx` | 2 | 2 |
| `apps/web/src/routes/create-agent-dialog.tsx` | 1 | 1 |

These three files' 7 handwritten buttons are all hand-written in `apps/web/src/secondary/secondary.css` (931 lines) (`.team-layout-tabs` / `.team-layout-tab` / `.team-layout-tab--active`, with their own media queries). In the same page `components/ui/button` and the handwritten class names coexist —— which is the source of "the button has two styles".

**Whole-domain measurement**. The caliber is the **sum of the four bare control kinds** — `<button>` / `<input>` / `<select>` / `<textarea>`: counting only `<button>` misses 33 spots (`<input>` 22 · `<textarea>` 7 · `<select>` 4), while `ui/input` and `components/ui/input` two generations coexisting is exactly the same-class problem. The table values taken on the **post-XMON-20** tree (parenthesized = the `fa54bba` baseline):

| Domain | `<button>` | `<input>` | `<select>` | `<textarea>` | Total | Handwritten classes | Files consuming `components/ui/button` |
|---|---|---|---|---|---|---|---|
| pages | 35 | 5 | 3 | 0 | 43 | 31 | 0 |
| detail | 34 | 6 | 0 | 2 | 42 | 30 | 0 |
| chief | 17 | 1 | 0 | 2 | 20 | 14 | 0 |
| overlay | 15 | 3 | 0 | 1 | 19 | 17 | 1 |
| resources | 15 | 1 | 0 | 1 | 17 | 14 | 2 |
| routes | 18 → 7 → **1** | 5 | 1 | 1 | 25 → 14 → **8** | 17 → 7 → **4** | 2 → 8 → **9** |
| board | 12 | 0 | 0 | 0 | 12 | 0 | 3 |
| overlays | 8 | 0 | 0 | 0 | 8 | 5 | 0 |
| ui (primitive body) | 1 | 1 | 0 | 0 | 2 | 0 | — |
| **Total** | **155 → 144 → 138** | **22** | **4** | **7** | **188 → 177 → 171** | **128 → 118 → 115** | **10 → 16 → 17 files** |

**"Handwritten classes" is the fifth column XMON-20 added** (caliber = the class-name count hanging on these bare controls and defined as a selector in any `apps/web/src` `.css`, domain-internal distinct). It is the direct reading of "the button has two styles": one set from `components/ui/*`, one set from the domain css. Of the site-wide 118 classes, `pages` / `detail` / `chief` three domains hold 75, corresponding to B4 not-started.

**Per-file ledger** (same caliber, only files with bare controls listed; "handwritten classes" = that file's distinct, not summable across rows):

| File | button | input | select | textarea | Total | Handwritten classes | Owning batch |
|---|---|---|---|---|---|---|---|
| `pages/project-new-page.tsx` | 14 | 4 | 0 | 0 | 18 | 12 | B4 tall three |
| `board/sidebar.tsx` | 9 | 0 | 0 | 0 | 9 | 0 | #414 pilot slice |
| `pages/project-page.tsx` | 8 | 1 | 0 | 0 | 9 | 5 | B4 tall three |
| `pages/schedules-page.tsx` | 6 | 0 | 3 | 0 | 9 | 7 | B4 tall three |
| `detail/branch-dialog.tsx` | 6 | 2 | 0 | 0 | 8 | 4 | B4 tall three |
| `detail/docpane.tsx` | 8 | 0 | 0 | 0 | 8 | 6 | B4 tall three |
| `overlay/mention-picker.tsx` | 7 | 1 | 0 | 0 | 8 | 9 | B3 overlay-content family |
| `chief/chief-drawer.tsx` | 6 | 0 | 0 | 1 | 7 | 5 | B4 tall three |
| `detail/composer.tsx` | 5 | 1 | 0 | 1 | 7 | 5 | B4 tall three |
| `resources/create-provider-dialog.tsx` | 6 | 1 | 0 | 0 | 7 | 6 | first real-domain slice |
| `routes/agent-detail-page.tsx` | 0 | 1 | 1 | 1 | 3 | 3 | first real-domain slice (in-shell neighbor page) |
| `overlay/more-menu.tsx` | 5 | 0 | 0 | 0 | 5 | 3 | B3 overlay-content family |
| `overlay/new-task-dialog.tsx` | 3 | 1 | 0 | 1 | 5 | 4 | B3 overlay-content family |
| `chief/chief-agent-dialog.tsx` | 3 | 1 | 0 | 0 | 4 | 4 | B4 tall three |
| `detail/review-dialog.tsx` | 2 | 1 | 0 | 1 | 4 | 4 | B4 tall three |
| `overlays/search-panel.tsx` | 4 | 0 | 0 | 0 | 4 | 1 | B3 overlay-content family |
| `pages/dir-browser.tsx` | 4 | 0 | 0 | 0 | 4 | 4 | B4 tall three |
| `resources/create-machine-dialog.tsx` | 4 | 0 | 0 | 0 | 4 | 2 | first real-domain slice |
| `routes/api-key-create-dialog.tsx` | 0 | 4 | 0 | 0 | 4 | 0 | B2 · secondary surface |
| `chief/chief-model-select.tsx` | 3 | 0 | 0 | 0 | 3 | 2 | B4 tall three |
| `chief/edit-charter-dialog.tsx` | 2 | 0 | 0 | 1 | 3 | 3 | B4 tall three |
| `detail/overlays.tsx` | 3 | 0 | 0 | 0 | 3 | 3 | B3 overlay-content family |
| `detail/stop-confirm-dialog.tsx` | 2 | 1 | 0 | 0 | 3 | 2 | B4 tall three |
| `detail/transcript.tsx` | 3 | 0 | 0 | 0 | 3 | 4 | B4 tall three |
| `board/repo-filter.tsx` | 2 | 0 | 0 | 0 | 2 | 0 | #414 pilot slice |
| `chief/chief-settings.tsx` | 2 | 0 | 0 | 0 | 2 | 3 | B4 tall three |
| `detail/accept-dialog.tsx` | 1 | 1 | 0 | 0 | 2 | 1 | B4 tall three |
| `detail/dhead.tsx` | 2 | 0 | 0 | 0 | 2 | 2 | B4 tall three |
| `detail/user-menu.tsx` | 2 | 0 | 0 | 0 | 2 | 0 | B4 tall three |
| `overlays/plan-dropdown.tsx` | 2 | 0 | 0 | 0 | 2 | 2 | B3 overlay-content family |
| `pages/github-issues-dialog.tsx` | 2 | 0 | 0 | 0 | 2 | 2 | B4 tall three |
| `resources/create-secret-dialog.tsx` | 1 | 0 | 0 | 1 | 2 | 2 | first real-domain slice |
| `resources/skills-page.tsx` | 2 | 0 | 0 | 0 | 2 | 2 | first real-domain slice |
| `board/tag-filter.tsx` | 1 | 0 | 0 | 0 | 1 | 0 | #414 pilot slice |
| `chief/chief-wake.tsx` | 1 | 0 | 0 | 0 | 1 | 0 | B4 tall three |
| `overlay/delete-project-confirm.tsx` | 0 | 1 | 0 | 0 | 1 | 1 | B3 overlay-content family |
| `overlays/chip-popover.tsx` | 1 | 0 | 0 | 0 | 1 | 1 | B3 overlay-content family |
| `overlays/dismiss.tsx` | 1 | 0 | 0 | 0 | 1 | 1 | B3 overlay-content family |
| `pages/shell.tsx` | 1 | 0 | 0 | 0 | 1 | 1 | B4 tall three |
| `resources/machines-page.tsx` | 1 | 0 | 0 | 0 | 1 | 1 | first real-domain slice |
| `resources/shell.tsx` | 1 | 0 | 0 | 0 | 1 | 1 | first real-domain slice |
| `routes/board-page.tsx` | 1 | 0 | 0 | 0 | 1 | 1 | #414 pilot slice |
| `ui/button.tsx` | 1 | 0 | 0 | 0 | 1 | 0 | primitive itself |
| `ui/input.tsx` | 0 | 1 | 0 | 0 | 1 | 0 | primitive itself |

The file count of `chief` / `detail` / `pages` / `overlays` consuming the shadcn `Button` is 0, consistent with §0's "B3 / B4 not started". The per-file distribution of `routes/`'s 18 (for batch reconciliation, baseline `fa54bbad`): `team-page` 3 · `account-page` 3 · `agent-detail-page` 3 · `agent-model-select` 3 · `api-key-create-dialog` 2 · `api-keys-page` 1 · `board-page` 1 · `create-agent-dialog` 1 · `team-chart` 1. B2 migrated 11 away, XMON-28 migrated 7 away, `routes/` now left `board-page` 1; in between `agent-detail-page` gained 1 from XMON-15 (#536), see the re-run record below.

**Caliber revision (effective from this line)**: §6.2's batch-assignment criterion expands from **two edges** to **three edges** — the third = **handwritten controls** (bare `<button>` / `<input>` / `<select>` / `<textarea>` / one-off class-name controls) also constitute consumption points and must point to a batch. The per-file table's "owning batch" column lands per this criterion, **45 files no "unnamed" row** (44 rows after XMON-28, `routes/agent-model-select.tsx` zeroed out of the table).

**The three-row re-check conclusion (checked after XMON-20 migration landed)**: the `#414 pilot slice` / `B3` / `B4` three rows' **"primitive consumption point" counts need no change** (the §5.2 two edges stay valid), but the **acceptance scope must carry the handwritten controls too** — per the per-file table (counts directly summable, class counts read from the domain-level distinct above): B3 becomes "3 primitive consumption points **+ 30 bare controls**", B4 "11 primitive consumption points **+ 102**", `#414 pilot slice` "1 primitive consumption point **+ 13**"; the B2 row left 26 (resources 17 + in-shell neighbor page 9) + secondary remnant 4.

**Re-run record (XMON-28 @ `38c945b9`, PR #547)**: `routes/agent-detail-page.tsx` 4 + `routes/agent-model-select.tsx` 3 bare `<button>` folded into the `components/ui` `Button` (ghost), this volume's three tables refreshed against the landed tree (`node scripts/count-raw-controls.mjs`): domain table `routes` row = button **1** / total **8** / handwritten classes **4** / files consuming `ui/button` **9**; site-wide total = **138** / **171** / **115** / **17 files**; the per-file table deletes the zeroed `routes/agent-model-select.tsx` row, the `routes/agent-detail-page.tsx` row changes to `0 | 1 | 1 | 1 | 3 | 3`.

The table-arrow **middle value = XMON-20 @ its re-run time point**, correct at that time point; between the `routes` row's middle value and the present value sits XMON-15 (#536) — it added the "in-progress" row to `agent-detail-page.tsx` after this volume's baseline and after XMON-20's re-run, i.e. the 4th bare `<button>` (`routes` therefore 7 → 8, site-wide 177 → 178). So that row's `7 → 1` net difference 6 is **not** the migration amount: XMON-28 actually migrated **7** (agent-detail-page.tsx 4 + agent-model-select.tsx 3), the other 1 brought in by XMON-15. The handwritten-classes column was not sampled separately for that XMON-15 intermediate state, so only the two ends are recorded.

Per the present value, the B2 row left **20** (resources 17 + in-shell neighbor page 3) + secondary remnant 4 = **24**. §0 / §1's batch-table numbers still freeze at each row's annotated time point (B2 row 30), not synced per this line — batch-level recomputation is not this change's scope.

- **`#414 pilot slice`'s "this batch only closes" no longer holds**: of its 13 bare controls `board/sidebar.tsx` alone holds 9 (all the sidebar nav rows), #414 only migrated the card family's tokens and utility classes — per the new caliber this is "full primitive switch + full control switch" two things, not one.
- **B4 is the largest household and now quantifiable**: 105 bare controls / 75 classes, `pages/project-new-page.tsx` one file 18 (the site-wide largest single point); starting only by primitive consumption points would miss this whole class of files.
- **B2 · secondary surface is the first surface under this caliber closed per the new ledger**: its three page shells recorded "this time no primitive consumption point" in §5.2, only surfacing through this section's ledger; after XMON-20 migrated it, that surface only has `routes/api-key-create-dialog.tsx`'s 4 permission-bit `<input>`.
- **One leftover needing a human ruling**: the `resources/create-*-dialog` three pieces (13 bare controls) were ruled **exclusion surfaces** in #422 (shell to B1, content family to B3), but §5.2 records the same three pieces' `ui/input` under the "first slice done" row — the same batch of files' control ledger and primitive ledger land on two rows. This table records per #422's original ruling under the exclusion surface, **whether to single out a row for the resources-side handwritten controls is left to the parent ticket**.

## 7. Data-Collection Commands

```sh
# 裸控件账本（§6.5）—— 每域一行 + 逐文件两表（四类口径 + 手搓类列），直接贴进本节
node scripts/count-raw-controls.mjs

# 前沿消费点（§5.2）—— 17 文件 / 18 处：ui/button 14 · ui/input 3 · ui/chip 1
grep -rn -E "from '(\.\./|\.\./\.\./|\./)ui/[a-z-]+\.js'" apps/web/src --include=*.tsx

# 域 css 体量（§5.1；decl = 形如 `prop: value;` 的行）
for f in $(find apps/web/src -name '*.css' | sort); do
  printf "%-42s %5s行 %5s decl %4s rule\n" "${f#apps/web/src/}" \
    "$(wc -l < $f)" \
    "$(grep -cE '^[[:space:]]*[-a-zA-Z]+[[:space:]]*:.*;' $f)" \
    "$(grep -cE '^[^@/].*\{' $f)"
done

# 裸控件 census（§6.5）—— 四类之和，全站 188 处
for t in button input select textarea; do
  printf "%-10s %s\n" "<$t" "$(grep -rho "<$t" apps/web/src --include=*.tsx | wc -l)"
done
# 逐域分解（一域一行，末列 = 四类之和）
for d in apps/web/src/*/; do
  b=$(grep -rho '<button' "$d" --include=*.tsx | wc -l)
  i=$(grep -rho '<input' "$d" --include=*.tsx | wc -l)
  s=$(grep -rho '<select' "$d" --include=*.tsx | wc -l)
  t=$(grep -rho '<textarea' "$d" --include=*.tsx | wc -l)
  [ $((b+i+s+t)) -gt 0 ] && printf "%-22s btn=%-4s input=%-3s select=%-3s textarea=%-3s 合计=%s\n" \
    "$(basename $d)" "$b" "$i" "$s" "$t" "$((b+i+s+t))"
done
# 域名内逐文件（归批对账用；routes/ × routes/ 的 25 处就是这样拆出来的）
for f in apps/web/src/routes/*.tsx; do
  n=$(( $(grep -c '<button' "$f") + $(grep -c '<input' "$f") + $(grep -c '<select' "$f") + $(grep -c '<textarea' "$f") ))
  [ "$n" -gt 0 ] && printf "%-40s %s\n" "$(basename $f)" "$n"
done
# 消费 shadcn Button 的文件数
grep -rl 'components/ui/button' apps/web/src --include=*.tsx | wc -l

# 三闸（本册基线绿；本票未复跑，见下方复跑记录）
pnpm -r typecheck                       # TC_EXIT=0
rtk proxy pnpm exec biome ci .          # 0 error / 4 warnings / 25 infos（459 files）
# 全量 e2e（夹具构建单次；私有端口，跑前 lsof 查占用）
cd apps/web && E2E_PORT=8429 pnpm exec playwright test    # 472 passed (44.8s)
```

**Re-run record (XMON-20 @ `fa54bbad` + this ticket's change)**: §7's three data-collection commands all re-run. §6.5's census refreshed against the post-this-ticket tree (four-kind total 177, `fa54bba` baseline 188; difference 11 = the bare `<button>` this ticket migrated away); §5.1 / §5.2 refreshed to "domain css one line one value + consumption points 17 files / 18 spots", the other rows value-for-value consistent with `fa54bbad`.

**Re-run record (XMON-17 @ `d37937f`)**: the first two data-collection commands re-run, the readings are the then §5.1 / §5.2 tables (consumption points 20 files / 22 spots). That ticket **did not re-run the three gates** — only this volume changed, executed per the repo rule "docs-only changes do not run".

> e2e and lint data-collection discipline: `pnpm lint` in the Bash tool is rewritten by the rtk hook into a false red, the real value takes `rtk proxy pnpm exec biome ci .`; loopback commands always prefixed `env -u http_proxy … NO_PROXY='*'`.