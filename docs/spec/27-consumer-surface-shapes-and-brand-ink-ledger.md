# 27 · Consumer surface shapes and the brand-ink ledger (#1054 / #1055)

> Canonical chain: ADR 0012 D1 (registry default geometry is canonical; user discretion takes effect only through the token layer) + #987 (`--primary` stays neutral; brand ink only goes through the spot family) + #1006 R4 (links align with `--primary`). The machine ledger = `scripts/ui-consumer-registry.json` (two sections: `squareBoxes` / `brandInkText`); the gates = `scripts/ui-consumer-shape-gate.mjs` (shape) + `scripts/ui-drift-gate.mjs` G6 (brand-ink roles). This volume is the human-readable surface: conventions, per-site dispositions, and the wave-1 attribution reconciliation. Where the machine surface conflicts with this volume, the gates' ruling wins and this volume gets fixed back.

## 0. Why this ledger exists

ADR 0010's round carried the mandate of "free geometry redesign", and every consumer surface in the App was drawn square; ADR 0012 flipped the canon to "registry default geometry is canonical", but the migration surface only covered `components/ui` (#1003 + the #989 gate). Result: the components are round while the places drawing them are still square — the coordinator's 2026-10-08 reconnaissance counted 73 "visible square boxes" (32 files). In the same period, #987/#1006 R4 restricted brand ink `--card-button` to spot emphasis (selection marks / indicators / small badge glyphs / solid fills), and reconnaissance counted 25 places using it as a text color (17 files) — what the user saw was "some purple, some black".

The shared root cause of both defect classes is a **blind spot in the gates**: the #989 registry gate only looks at `components/ui` same-originity; `ui-debt-gate` counts CSS lines and naked controls; `ui-drift-gate` G1–G5 checks hex escapes and dead selectors — none of them rules on "the shape of the box a consumer draws" or "the wrong role in a canonical slot". Wave 1's six lanes (#1004–#1010, PRs #1057–#1075) cleaned up most of it by domain; this ledger closes the remainder and sinks both criteria into machine gates.

## 1. Conventions (what counts as "a consumer drawing a box", and what counts as "legitimate neutralization")

Scan surface = `apps/web/src/**/*.{ts,tsx}` minus `components/ui/` (that is #989's surface, where `rounded-none` is mostly neutralizing primitive shapes, which is legitimate). Comments are stripped first (sharing the single implementation in `scripts/ui-normalize.mjs` with the registry gate); each line is then judged:

**R1 · explicit square-corner declaration**: the line has a **bare** `rounded-none` utility (no variant prefix; `before:rounded-none` is a state-layer form, not the element's box), plus an **unconditional coating** on the same line:

- bare `bg-*` (except `bg-transparent` / `bg-none` / `bg-clip-*`);
- **structural border**: bare `border` or width forms `border-2` / `border-[1px]`. Color forms (`border-(--x)`, `border-input`, `border-primary`), single-side forms (`border-t/-b/-l/-r/-x/-y` and valued variants like `border-l-4`), style forms (`border-dashed`, which shows nothing without a width), and resets (`border-none/transparent`) all do **not** count as structural borders;
- `shadow-*` (except `shadow-none`) or `[box-shadow:…]`;
- `ring` (except `ring-0` / `ring-inset` / `ring-offset*`).

**R2 · silent enclosed box**: the line has **no** bare `rounded-*` declaration at all, yet has both a structural border and a bare bg fill — the square corners come from silence (Tailwind's default border-radius = 0).

**Legitimate neutralization (not judged as a box)**:

- state-variant coatings (tints with `hover:` / `data-*:` / `aria-*:` / `before:` prefixes) — a hover/selected wash on a flat line is not a resting box; its geometry belongs to the line family where it lives (e.g. the sidebar `before:` pill, L1 #1058 ruling 2: "it is the tint, not the button box").
- Primitive neutralization strings of the `border-none bg-transparent shadow-none` form (ghost row buttons, popover shell wrappers, zero-decoration inputs inside a box).
- Full-bleed bands (dialog header/footer `border-t` bands, `border-l-4` quote blocks): a single-side border does not enclose; these are layout bands riding on the parent box.

**Registered blind spots** (declared honestly; gate v1 does not judge them):

1. **bg-only layout bands with no border, no shadow, no radius declaration** (e.g. the section band of `bg-(--secondary) px-4`) do not hit R2 — pulling 42+ lines of layout background into the ledger costs more noise than it pays. This inventory manually walked this family: the chief-settings card family (CARD_CLS etc.) was disposed of as a family unit (§2); the rest is sectional layout, not "boxes".
2. **Non-square-corner geometry deviations** (e.g. `rounded-full` pills, one-off 8px tiers) are out of this gate's range — judging "whether arbitrary geometry has a registry basis" requires naming the component per box; it cannot be mechanically judged line by line. The existing registration practice = review ruling + call-site note (filter-chip pill, L1 #1004 ruling 4; org-chart node 8px, L2 #1005). Gate v1's enforcement surface = the square-corner defect family named by #1054's acceptance ("any square corner without a registry basis must go red"); pulling non-square deviations into the ledger too = a full box-ledger engineering effort (one entry per pill/disc/one-off tier), left to later tickets extending the same ledger form — not an expansion of power in this ticket.
3. **Class strings composed across constants** (base constant + variant constant concatenation) cannot be fully seen by line scanning: the combined effective geometry is **not enforced by the gate** (line-level scanning cannot see the composed state); the ledger's rides-primitive / state-surface entries are documented dispositions of lines the gate caught; the composition surface is backstopped by review and this volume's manual walk.

**Brand-ink text-role convention (G6)**: in consumer surfaces, `text-(--card-button)` / `text-(--focus-ring)` / `text-[var(--card-button)]` / same-shape `fill-`/`stroke-` / any property form `[color:var(--card-button)]` / CSS `color: var(--card-button)` = brand ink used as a text role. Every occurrence must be registered in the ledger's `brandInkText` section with `{file, anchor, role, reason, contrast}`, where role is limited to `selection-mark` (selection mark) / `indicator` (indicator) / `badge-glyph` (small badge glyph) — i.e. #987's spot roles; the Paper revamp (apps/web/DESIGN.md "Buttons") adds `action-link`: the ochre text action links on board task cards (no solid buttons on the card). Solid fill (`bg-(--card-button)`) is that slot's canonical role (card button solid fill), not checked. Body/labels/row values → the text tiers; primary action buttons → `--primary` (the registry Button default tier); links → the registry link tier (`text-primary` + hover underline, #1006 R4). Contrast is measured per the #988 method (WCAG 2.1 `(Lhi+0.05)/(Llo+0.05)`, both modes, no estimating).

Rescan commands (the mechanical definition of the conventions is exactly this; the gate scripts are the only implementation):

```sh
node scripts/ui-consumer-shape-gate.mjs   # R1/R2 + two-way ledger reconciliation
node scripts/ui-drift-gate.mjs            # G1–G6 (G6 = brand-ink roles)
```

## 2. Shape disposition master table (coordinator reconnaissance: 73 sites → per-site attribution)

Status vocabulary: **wave-1** = already changed by a wave-1 lane (PR tagged); **change** = changed by this PR (basis tagged); **delete** = dead recipe deleted; **register** = ledger registration of a deviation/ride (no visual change); **neutralize** = re-verified as legitimate neutralization or a state layer, not entering the gate. Line numbers = at reconnaissance time (2026-10-08); attribution re-verified against the current tree by file + semantic anchor.

| # | Reconnaissance site (file:line) | What it is | Disposition |
| --- | --- | --- | --- |
| 1 | board/board.tsx:322 | board-column column container | **change** rounded-xl (card-tier shadow family attaches to the Card basis; #1004's reconciliation declared the leftover surface "residue for a later ruling", ruled by this ticket); visual-polish re-pinned 0px→14px in both modes |
| 2 | board/done-confirm-dialog.tsx:37 | confirm-button neutralization string | **wave-1** #1059/#1072 (absorbed into DialogFooter; the line no longer exists) |
| 3 | board/drag-card.tsx:31 | drag clone card | **change** rounded-xl (mirrors the todo-card's registry Card geometry); board-dnd re-pinned 0px→14px in both modes |
| 4 | board/reset-confirm-dialog.tsx:43 | same as #2 | **wave-1** #1059/#1072 |
| 5 | board/sidebar.tsx:259 | rail-row before: pill | **neutralize** (state tint layer; L1 #1058 ruling 2 "pill keeps its own radius; it is the tint, not the button box") |
| 6 | board/sidebar.tsx | sidebar-team-row--active | **change** CDS PR-3: drop `rounded-none`, switch to `rounded-[length:var(--cds-radius-lg)]` (8px pill); the ledger entry retires in sync |
| 7 | chief/chief-drawer.tsx:146 | TURN_TOOLS_CLS | **change** rounded-(--radius-popover)=12px (flow-surface family basis: A1 BUBBLE_USER_CLS same tier "geometry pinned back to the original value") |
| 8 | chief/chief-drawer.tsx:671 | theme-switcher tray | **change** rounded-lg (registry Popover basis; plan-dropdown #1059 same vocabulary) |
| 9 | chief/chief-drawer.tsx:710 | 54px gate banner | **change** rounded-xl (card-family surface attaches to the Card basis) |
| 10 | chief/chief-drawer.tsx:760 | example-card icon tile | **change** rounded-lg (tile vocabulary: schedules-page size-7 tile L4 precedent, same tier) |
| 11 | chief/chief-drawer.tsx | chief-composer | **resolved** switched to `--radius-composer` 14px (Claude Desktop UI batch); exits the squareBoxes ledger |
| 12 | chief/chief-settings.tsx:68 | EMPTY_CARD_CLS | **change** rounded-xl (Card/Empty basis; card family unified, see §4 adjacent finding 1) |
| 13 | chief/chief-settings.tsx:95 | TAB_INDICATOR_CLS | **change** rounded-md (registry Tabs trigger tier; the shape vocabulary of #644's "pill shape carried by consumer CSS", concentric with the lg list's p-0.5 at 10−2=8px) |
| 14 | chief/chief-settings.tsx:234 | TabsList override | **change** remove rounded-none (registry Tabs default rounded-lg shows through; same as #1008's override removal) |
| 15 | chief/chief-settings.tsx:328 | charter dashed empty-state box | **change** rounded-xl (registry Empty component vocabulary = rounded-xl + border-dashed, verbatim match) |
| 16 | chief/recipes.ts:14 | MENU_SHELL_CLS | **wave-1** #1008 (d93f9709 removed the override, "radius goes back to the registry default") → now **register** rides-primitive (PopoverContent rounded-lg) |
| 17 | chief/recipes.ts:28 | SELECT_TRIGGER_CLS | **wave-1** #1008 → now **register** rides-primitive (Button rounded-lg) |
| 18 | detail/branch-dialog.tsx:44/51/110/417 | branch box family | **wave-1** #1072 (BranchBox/READONLY_BOX rounded-lg border-input vocabulary) |
| 19 | detail/composer.tsx | detail composer | **resolved** switched to `--radius-composer` 14px (Claude Desktop UI batch); exits the squareBoxes ledger |
| 20 | detail/review-dialog.tsx:29/155 | review-surface boxes | **wave-1** #1072 (notice box rounded-lg) |
| 21 | detail/spec-block.tsx:35 | brief card | **change** rounded-lg (bordered content-box vocabulary, #1072 same-domain precedents notice/BranchBox same tier); spec-brief-card re-pinned 0px→10px; the "composer card family" binding is released as a Q7 registered deviation |
| 22 | detail/stop-confirm-dialog.tsx:47 | same as #2 | **wave-1** #1059/#1072 |
| 23 | detail/transcript.tsx | chat-bubble | **resolved** switched to `--radius-bubble` 10px (Claude Desktop UI batch); exits the squareBoxes ledger |
| 24 | detail/user-menu.tsx:52 | user-menu tray | **change** rounded-lg (registry Popover basis; the three "attribution pending coordinator" declarations are closed by this ticket — geometry first, the full popover rebuild still belongs to the attribution ticket); visual-polish re-pinned 0px→10px in both modes |
| 25 | overlay/mention-picker.tsx:304 | search input | **wave-1** #1008 (80c272ec "restore the registry radius") → now rides the Input component default, not in the ledger (color-form border does not hit R2) |
| 26 | overlay/mention-picker.tsx:351 | cancel-button neutralization | **wave-1** #1060 (rounded-none removed) → **neutralize** |
| 27 | overlay/mention-picker.tsx:359 | insert button | **wave-1** removed rounded-none; brand-ink text **change** (see §3 #8) |
| 28 | overlay/more-menu.tsx:54 | more-menu tray | **wave-1** #1060 (floating-shell retired → registry overlay) |
| 30 | overlay/new-task-dialog.tsx:102 | project-menu tray | **wave-1** #1008 (PROJECT_MENU_CLS keeps only the layout slot) |
| 31 | overlay/token-gate.tsx:90 | token input box | **change** remove rounded-none (#1045 already restored the Input component to rounded-lg; this consumer's override was actively re-squaring it) → rides the component default, not in the ledger |
| 32 | overlays/chip-popover.tsx:39 | chip popover shell | **wave-1** #1059/#1060 (chip-popover rhythm, d93f9709) |
| 33 | overlays/plan-dropdown.tsx:45/63 | plan tray/rows | **wave-1** #1059 (V2 tray skin → registry menu default) |
| 34 | pages/dir-browser.tsx:45 | directory browser tray | **wave-1** #1061 |
| 35 | pages/github-issues-dialog.tsx:28 | issues button | **wave-1** #1061 |
| 36 | pages/parts.ts:20 | SEG_GROUP_CLS | **delete** (#980 rulings ②④ retired it, header rule "delete once migration completes"; L2 #1057 migrated the last two consumers, so the deletion condition held while both lanes waited on each other — this ticket executes) |
| 37 | pages/project-new-page.tsx:80/86/92/97/110/523 | new-project surface, 6 sites | **wave-1** #1061 |
| 38 | pages/project-page.tsx:79/410/481/514/517/550/554 | project surface, 7 sites | **wave-1** #1061 |
| 39 | pages/project-settings-page.tsx:120 | branch chip | **wave-1** #1061 |
| 40 | pages/schedules-page.tsx:141/192/193/322/346/353/424/532 | schedules surface, 8 sites | **wave-1** #1061/#1074 (sched-form-row rounded-lg, tile rounded-lg bg-muted) |
| 41 | resources/parts.tsx:60 | RES_SORT_TRIGGER_CLS | **delete** (#1057 Merge Danger declared "RES_* square constants retire with L3's agent-detail migration"; #1061 finished the migration, 0 consumers measured) |
| 42 | resources/parts.tsx:66 | RES_SORT_MENU_CLS | **delete** (same as above) |
| 43 | resources/parts.tsx:73 | RES_SORT_ROW_CLS | **delete** (same as above; its indicator check-color entry is deleted with it, see §3) |
| 44 | routes/account-page.tsx:71 | language trigger button | **wave-1** #1057/#1061 |
| 45 | routes/account-page.tsx:77 | language tray | **wave-1** #1057/#1061 |
| 46 | routes/agent-model-select.tsx:52/58 | model-select triggers | **wave-1** #1061 (0255f3cb: select triggers rounded-none → rounded-lg) |
| 47 | routes/api-key-create-dialog.tsx:13/113/158 | key surface (2 comments + 1 box) | **wave-1** #1061 (the comment lines retired with the #947-convention lines) |

The 73 reconnaissance sites counted by site-row = the 47 groups above (multi-line groups sum to 73 by the original reconnaissance lines). **Sites newly caught by the gate's conventions but not on the reconnaissance list** (the "silent square corners" and state surfaces the looser convention missed):

| Site | Disposition |
| --- | --- |
| components/model-select-core.tsx SEARCH_BOX_CLS (hand-rolled search box, no rounded declaration at all) | **change** + rounded-lg (Input box basis) |
| chief/chief-settings.tsx CARD_CLS / charter text block (bg-only silent square corners, card family) | **change** + rounded-xl (unified with the EMPTY/LIST card family, §4-1) |
| chief/chief-settings.tsx LIST_CARD_CLS rounded-[8px] (non-square corner, out of the gate's range) | **change** → rounded-xl (card-family unification; the 8px one-off tier's §3.1(a) authorization is voided by ADR 0012 D1's end of "free geometry" and converges back to the registry default) |
| chief/chief-settings.tsx TAB_CLS / agent row buttons (Button-carried overrides) | **change** remove rounded-none (component defaults lg/md show through, same as the L5 #1008 sweep) |
| chief/chief-drawer.tsx example-card Button (bg-secondary carrier) | **change** remove rounded-none (Button rounded-lg shows through) |
| board/board.tsx drop-tint two lines (border-(--drop-tint-*) color form) | **neutralize** (#616 state tinting riding the column-box geometry; color-form border does not enclose, the gate does not judge) |
| detail/user-menu.tsx SEG_OFF (border color form, no bg) | **neutralize** (rides the SEG_BASE rounded-[6px] composed base) |

**Current ledger entries** (`scripts/ui-consumer-registry.json` squareBoxes, 7): deviation 4 = detail/composer (Q7), chief-composer (Q7), chat-bubble (#1009 A2); sidebar-team-row--active's square corners retired with CDS PR-3; rides-primitive 3 = MENU_SHELL_CLS (PopoverContent), SELECT_TRIGGER_CLS (Button), new-task-machine (Button).

**Registry basis quick reference** (`scripts/ui-upstream-snapshots.json`, base-nova): card/dialog/alert-dialog content = rounded-xl; popover/dropdown content, input/textarea/select-trigger/button bases, tabs list = rounded-lg; dropdown/select item, tabs trigger, tooltip = rounded-md; bubble content = rounded-xl; empty = rounded-xl (border-dashed); badge = rounded-4xl; kbd = rounded-sm; checkbox = rounded-[4px]; panel adapter layer = rounded-[12px]; radius base `--radius: 0.625rem` (where the token layer's freedom lives).

## 3. Brand-ink disposition master table (#1055; reconnaissance: 25 sites → per-site attribution)

Reconnaissance convention = the `text-(--card-button)` text role (including variant-prefixed forms); the coordinator's 2026-10-08 tally was 25 sites / 17 files; the same-convention mechanical rescan (base point before wave-1 merges, `a4c31c1f^`) = 28 lines / 17 files (including double forms on one line); the difference = reconnaissance counted by "site", merging double forms on one line. Disposition is slotted by role, not by color:

| # | Site (file; line numbers drift with the tree, anchor = semantic class name) | Current slot → semantics → intended slot | Disposition |
| --- | --- | --- | --- |
| 1-2 | board/filter-panel (selected outline + invert button) | brand ink → filter-control emphasis → component default / text tier | **wave-1** #1058 (a4c31c1f, filter panel aligned to registry geometry and tone) |
| 3 | board/notify-banner (bell glyph) | brand ink → small badge glyph (spot) → original slot | **register** badge-glyph (token-note canon: "the glyph on it goes through spot"; non-text 3:1 gate, measured in docs/verify/988/; re-measured in §5 of this ticket) |
| 4-5 | components/chat/live-row (spinner ×2 surfaces) | brand ink → in-progress indicator (spot) → original slot | **register** indicator (non-text glyph 3:1, re-measured §5) |
| 6-7 | detail/source-issue (orchestration session link / retry button) | brand ink → link-class action → registry link tier | **wave-1** #1059 (R4: Button variant=link text-primary; call-site note records the retirement) |
| 8 | overlay/mention-picker (insert button) | brand ink → **primary action button** → `--primary` neutral | **change**: Button default tier (neutral solid fill); brand-ink text / brightness hover / disabled neutralization all retired (disabled state goes through the registry opacity down-tier, same as source-issue #1006); before/after screenshots in docs/verify/1055/shots/ |
| 9-11 | overlay/new-task-dialog (project checks ×3) | brand ink → selection mark (spot) → original slot | **register** selection-mark |
| 12 | overlays/chip-popover (assignee check) | brand ink → selection mark (spot) → original slot | **register** selection-mark |
| 13 | overlays/plan-dropdown (indicator check color) | brand ink → selection mark → registry RadioItemIndicator native slot | **wave-1** #1059 (migrated along with the tray skin's retirement to the registry menu default) |
| 14-15 | pages/dir-browser (pressed state + check) | brand ink → selected/pressed emphasis → component default | **wave-1** #1061 |
| 16-17 | pages/project-new-page (indicator + check) | same as #13 | **wave-1** #1061 |
| 18-19 | pages/project-page (indicator + link) | brand ink → link → link tier | **wave-1** #1061 |
| 20 | pages/schedules-page (page-new-action) | brand ink → action text → text/primary tier | **wave-1** #1061 |
| 21 | resources/parts (RES_SORT_ROW indicator) | brand ink → selection mark | **delete** (dead recipe deleted with §2 #43; "left for L3 (legacy)" — L3 has since migrated the consumers away) |
| 22-23 | resources/shell (settings links ×2) | brand ink → link → link tier | **wave-1** #1057 (0bfbdefa: converge brand-ink text links to registry link tier) |
| 24 | routes/account-page (language check) | brand ink → selection mark (spot) → original slot | **register** selection-mark (#991 Q10 active-state emphasis surface; 0bfbdefa user-approved retention) |
| 25 | routes/account-page (name-button hover ink) | brand ink → row-value hover affordance → component default hover | **change**: seven-channel neutralization string + brand hover ink retired; ghost component default hover wash = registry affordance (mirror of the agent-detail surface's #980 ruling, AGENT_NAME_CLS precedent); before/after screenshots in docs/verify/1055/shots/ |
| 26 | routes/agent-detail-page (agent-name hover ink) | same as #25 | **wave-1** #1061 (this ticket brings the account surface up to the same form) |
| 27 | routes/team-chart (crown glyph) | brand ink → small badge glyph pressed on --spot-soft → original slot | **register** badge-glyph (0bfbdefa user-approved retention: "team-chart crown on bg-(--spot-soft)"; re-measured §5) |
| 28 | routes/team-page (settings button) | brand ink → link → link tier | **wave-1** #1057 |

**Current ledger entries** (brandInkText, 7 entries / 9 lines): selection-mark 4 (chip-popover check, account language check, new-task project checks ×3 lines same recipe), indicator 2 (live-row spinner, two surfaces), badge-glyph 2 (notify bell, team-chart crown). G6 gate: an unregistered brand-ink text role = red; a ledger entry with no matching line = red (two-way).

## 4. Adjacent findings and rollback surfaces (named-but-not-changed items; family-unit dispositions record their rollback surfaces here)

1. **chief-settings card-family consistency (already disposed of with the §2 adjacent table; the rollback surface is recorded here)**: the four card-family members (CARD/EMPTY_CARD/LIST_CARD/charter block) unified onto the Card basis rounded-xl. LIST_CARD's 8px and CARD/charter block's silent square corners are both **out of the gate's range** (not rounded-none), disposed of as a family unit following EMPTY_CARD (§2 #12) — the basis being that D1 voided the "free geometry" authorization and the 8px one-off tier lost its §3.1(a) premise (8px = rounded-md is already on the ladder). If review rules that the chief surface (ADR 0013 Multica replication domain) should keep the 8px family vocabulary, the rollback surface = one class name per each of the three constants.
2. **user-menu popover full rebuild**: this ticket only closes geometry (rounded-lg); the V2 shell skin of 1px ink line + plate-shadow + double-triangle Arrow remains (visual-polish pinned per theme). The full migration with "attribution pending coordinator" (against plan-dropdown #1059's registry menu default form) is still the attribution ticket's work.
3. **chat-bubble's stale comment**: the transcript.tsx bubble comment still says "12px rounded corners" (from the XMON-55 P3 era), no longer matching the rounded-none reality — the file belongs to #1009 A2's in-flight lane; this ticket does not touch it (disposition ② both-sides change ban), cleaned up when A2 lands.
4. **token-gate input's focus ring**: `focus-visible:[outline:2px_solid_var(--focus-ring)]` is the #388 old ring recipe; #982/#991 already restored the component-layer ring to the official form (ring-3 ring-ring/50). The consumer-surface ring form is outside this ticket's geometry range; it belongs to the later focus-ring convergence surface.

## 5. Contrast measurements (#988 method, both modes)

Tool = the canonical formula (sRGB relative luminance + `(Lhi+0.05)/(Llo+0.05)`, byte-identical source with `apps/web/e2e/measure-912.mjs`); color values are taken from the fixture stack's post-render `:root` truth (computed style, not static file reads); translucent values are composited onto the real background first. Gates: text 4.5 / non-text UI 3. Results land in `docs/verify/1055/colors/` (incremental.md + json); the changed surfaces (mention-picker insert, account name-button hover) and the registered surfaces (7 spot-role entries) all enter the table — brand ink's contrast as a text color is exactly its old problem; registration does not exempt measurement.

## 6. Gates and CI

- `scripts/ui-consumer-shape-gate.mjs`: R1/R2 scanning + two-way ledger reconciliation (unregistered = red / stale entry = red / structure-validation fail-closed exit 2). Zero dependencies, the ci.yml check job's **pre-install slot** (same row as the debt/registry gates).
- `scripts/ui-drift-gate.mjs` G6: brand-ink text roles + two-way ledger reconciliation, runs with the existing drift-gate step.
- Two-way verification records: `docs/verify/1054/gate-demo-{1-red,2-green,3-stale-red,4-green}.txt` and same-named files under `docs/verify/1055/` — unregistered square boxes / brand-ink text must go red, registered or correctly changed must go green, stale entries must go red; all are actual run outputs, not "theoretically would go red".
