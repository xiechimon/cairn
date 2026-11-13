# #1009 A0 evidence (ADR 0013 shell-form reversal: docked right panel → Multica-style floating window)

> Phase: **review passed (2026-10-08, user "go with all recommendations") → build phase**. Prototype evidence (§1–§5) +
> build evidence (§6–§8: carrier repin ⑨, probe repin zeroed, better-colors incremental measurement) archived in one volume.
> Rerun recipes are the per-section commands; stack discipline = verify-pacman SKILL.md (isolated live stack, never touch 8787/5173).

## 0. Conclusion summary

| Face | Result | Artifacts |
|---|---|---|
| fixture shape smoke (five routes + interaction contracts, 50 checks) | **50/50 PASS** | `drive-1009-a0-smoke.mjs` + `result-a0-fixture-smoke.json` + screenshots 01–13 |
| live stack forensics (real data, 24 checks) | **24/24 PASS** | `drive-1009-a0-live.mjs` (in the skill scripts/) + `result-a0-live.json` + `live-*.png` |
| chief domain + adjacent e2e (17 specs / 179 cases) prototype state | 136 green / 43 red (red = repin ledger, individually classified in §3) | `e2e-domain-status.txt` + `e2e-failed-list.txt` |
| same-domain e2e after repin | **178 green / 0 red** (all 43 red repinned, see §6) | rerun command same as §1 |
| visual probe three-way diff (start recon vs prototype vs #953 freeze) | KEPT 52 / DRIFT 5 / NOT-RUN 33 / VIOLATION 0 | `probe-pre-a0/` + `probe-after-a0/` |
| visual probe after repin (acceptance template v3 item 2) | **KEPT 109 / DRIFT 0 / NOT-RUN 0 / VIOLATION 0** (91 cases all green) | `probe-repinned/` |
| better-colors incremental measurement (acceptance template v3 item 3) | **both modes 14 pairs all pass** (floor 4.5 body / 3 UI glyphs) | `measure-a0-colors.mjs` + `colors-a0.json` |
| unit tests (web full 468) | all green (including the i18n-coverage new key `最小化`) | — |
| typecheck / lint | all green | — |

## 1. Rerun recipe

```sh
# fixture smoke (preview stack)
cd apps/web && pnpm exec vite build --mode fixture
pnpm exec vite preview --host 127.0.0.1 --port 8403 --strictPort &   # lsof-check the port before running
E2E_PORT=8403 node docs/verify/1009/drive-1009-a0-smoke.mjs

# live forensics (isolated stack)
node .claude/skills/verify-pacman/scripts/launch.mjs
VERIFY_EVIDENCE_DIR=$PWD/docs/verify/1009 \
  node .claude/skills/verify-pacman/scripts/drive-1009-a0-live.mjs
node .claude/skills/verify-pacman/scripts/cleanup.mjs

# domain e2e current state (red = repin ledger, not regression — see the §3 classification)
cd apps/web && E2E_PORT=8403 pnpm exec playwright test chief-panel chief-stream-markdown \
  chief-send-fallback chief-composer-tools chief-drawer-slash chief-drawer-model chief-fab \
  chief-settings hotkeys shell-consistency z-ladder board-docked-reflow board-zoom-fit \
  detail-3pane detail-narrow machines-chief-state overlay-focus

# probe three-way diff
pnpm --filter @pacman/web probe:dump --specs chief-panel chief-stream-markdown \
  chief-send-fallback chief-composer-tools chief-drawer-slash chief-drawer-model \
  chief-fab chief-settings --out docs/verify/1009/probe-after-a0
```

## 2. Registry item-by-item comparison table (coordinator 2026-10-08 corrected criterion: the judge = `scripts/ui-upstream-snapshots.json`)

This round (A0 prototype) makes **zero writes to `components/ui/`**. Item-by-item comparison:

| Item | Upstream snapshot form | Local form | Verdict |
|---|---|---|---|
| `button.tsx` | base-nova registry (snapshot hash `1df2d803…`) | unchanged; consumer sites keep using the #950 seven-channel neutralization utilities (HEAD_ICON_BTN_CLS etc., predating this round) | ledger `deviated` already registered (#411/#425 semantic mapping zero skins) — no new deviation this round |
| `dialog-shell.tsx` (adapter) | not a registry item (local composition layer) | unchanged (rewind confirmed the consumer sites are as-is) | ledger `adapter` already registered; **L3/#1006 has already flipped to the registry dialog composition — when the merge order collides, rewind the consumer sites to follow the L3 example (drop the self-carried padding wrapper, feed bare content into DialogFooter), owned by the build face** |
| `message-scroller / message / bubble / attachment / marker` (A1 five items) | base-nova registry, produced by the `ui-registry-refresh.mjs --items` pipeline | vendored to `/tmp/a1-primitives-1009/` (**uncommitted**, the A0/A1 phased discipline); **byte-for-byte identical** to the snapshot (the hash is the pipeline hash: ed1dd557 / dc60c69f / b6812e3f / 33d34435 / 59574fed) | registered in the A1 phase (pristine); not committed this round |
| floating window body (`chief-drawer.tsx` aside) | **not a registry item** — the host mechanism = Base UI non-modal Dialog + Portal (ADR 0013 D10/F11, does not touch 0012 D3) | geometry/skin = the ADR 0013 D2 full set of Multica original values (380×600, 8px inset, 12px radius, `--floating-shadow` dual-theme original value, opaque card base, edge-ring hairline ring) | basis = ADR 0013 (the user's 2026-10-08 thirteen-question decision), not the "square/round corner" adjective reading |
| FAB (`chief-root.tsx`) | not a registry item (application-face launcher) | 40px circle / 8px inset / floating-shadow + edge-ring = the ADR 0013 D4 Multica original values | same as above |

**This round has no "make it squarer" action**: the window's 12px radius and the FAB's full circle both come from the Multica original values pinned by ADR;
the consumer-site neutralization utilities (the rounded-none family) all predate this round (#950 seven-channel recipe), not extended, not changed.
The 12px radius ticks a one-off arbitrary value (§3.1(a)) and does **not** consume the #983 retired token
`--radius-popover` (ADR 0012 D4 explicit); the window is the only consumer site of that value, so migrate it to a token only if the build face rules so.

## 3. The 43-red classification (repin ledger, ADR 0013 D11 / ticket ⑨; behavior assertion semantics unchanged word-for-word)

| spec | red count | classification |
|---|---|---|
| board-docked-reflow | 8 | the whole spec pins the retired docked reflow state (0004 D8 deprecated) — repinned to "overlay zero reflow" semantics |
| chief-panel | 11 | docked 418 geometry pins ×6 + reflow pin + Esc-close-window pin (D3 reversed) + refresh-not-persistent pin (D5 reversed) + D7 mutual-exclusion pin |
| hotkeys | 9 | the `data-chief-open` marker family + the count-0 assertion family (D6 "closed = in DOM but inert" new contract) |
| shell-consistency | 5 | the FAB class/geometry family (48×48/16 family rule retired, D4) |
| chief-fab | 5 | same as above + the unreadOnly gate carrier |
| chief-stream-markdown | 2 | F-R16 bubble geometry repinned as the window width goes 418→380; F-R18 entrance-animation settle predicate (during scale the boundingBox reads the scaled value — repin adds a wait predicate, the same shape as #984's warning for A2) |
| detail-3pane | 1 | the 418 chief dock state pin (D7 mutual exclusion retired) |
| chief-drawer-model | 1 | the count carrier family for the popover reclaimed on window close |
| board-zoom-fit | 1 | `data-chief-open` two-state floor switch (#1035 face retires the reflow state and converges to a single state) |

**Non-repin real regressions: 0** — all 43 reds map one-by-one to the table above; the 136 greens cover the settings face / composer face / slash face /
send fallback / machines-chief-state / overlay-focus / z-ladder / detail-narrow and other behavior contracts.

## 4. This round's build verdict records (build face / review may overturn)

1. **The new z rung = `--z-floating: 15`** (above --z-docked, below --z-backdrop-low): the #688 rule
   "the active face always sits above the persistent face" holds as-is; the F8 single-point verdict = the registry overlay items being rendered ride
   --z-dialog through an already-registered deviation; the non-rendered items (ui/dialog, ui/alert-dialog) keep the upstream z-50 original text (never competing).
2. **Clearance reservation system landed**: `--chief-launcher-size/inset/clearance` + `pe-/pb-/above-chief-launcher`
   three utilities (app.css @utility, same shape as Multica base.css). Zero consumer sites this round: the bottom-right corner placement was checked route-by-route
   via smoke, no bottom-docked element gets hit (the detail composer send button is in the center column, board has no bottom-docked bar); when a consumer
   site appears, pick the utility per the Multica three-category classification.
3. **autofocus only recognizes the closed→open transition** (same rule as MUL-5522): a persistent-open load does not steal focus;
   after keepMounted the node stays resident, so the old "OverlayMount lags one frame then the ref callback first-focus" path retires.
4. **Drafts do not persist across a full page refresh** (same behavior as current main): D5 persists only the open state; Multica's per-workspace
   draft persistence, if aligning, is a separate ticket.
5. **The suppressed route set = agent detail + machine authorization** (coverage = the current state, no new faces invented): the root host keeps
   the hook instance alive (state survives the detour) but does not render the launcher/window and unregisters ⌘J. Whether the whole-site uniform coverage
   (including these two routes) is the terminal state is a review decision point.
6. **scrollAnchor (registry anchoring) A1 re-decided**: the A1 design recon already decided "no anchor, send-jumps-to-latest
   goes through useMessageScroller().scrollToEnd" to keep the #873 follow rule; anchoring as an enhancement face is left to the review decision.

## 5. Screenshot list

fixture: 01 board FAB closed state / 02 board window open / 03 new-task dialog presses the window (z rule) / 04 after minimize /
05 schedules window open (SPA resident) / 06–08 pages·resources·secondary three-shell window open / 09 detail window open + right column coexist /
10·10b fixture 111 hero·114 thread capture shape / 11 suppressed route / 12 settings view content swap / 13 live window open.
live: live-01 real thread window open / live-03 refresh restores the open state / live-05 schedules resident / live-06 detail overlay placement /
live-07 settings deep link / live-09 suppressed route.

## 6. Build phase: carrier repin (acceptance template v3 item 1, ADR 0013 D11)

After repinning all 43 reds, the same-domain 17 specs are **178 green / 0 red**. Per-family disposition (behavior assertion semantics unchanged word-for-word,
only the carrier / the already-decided behavior swapped in):

| spec | original red | disposition |
|---|---|---|
| chief-panel | 11 | the whole describe flipped to "floating form": 418 docked geometry → 380×600@8 + fixed + radius token + z15 + dual-layer shadow + no side-column squeeze; reflow pin → zero-reflow contrast shot; Esc-closes-window → Esc never closes (D3) + inner layer closes first kept; D9 refresh-closes → D5 refresh-restores (live-mock stub face; the fixture face zero-storage rule pinned separately); count-0 → hidden+count1 |
| hotkeys | 9 | the count-0 family → toBeHidden; escapeUntilHidden(drawer) → toggleUntilHidden (⌘J is the only keyboard collapse); pressesStayClosed(drawer) → pressesStayHidden new helper (the count-0 rule stays for the dialog family); the FAB mutual-exclusion comment folded into D4 |
| board-docked-reflow | 8 | the whole spec flipped to "overlay zero reflow": docked floor / reflow horizontal-scroll pins → open/close zero-geometry-jump contrast shots (nine failure modes rewritten: 1440/1024/RTL/worst-case data/card width/scrollbar disclosure); FLOOR 280 → 200 single state |
| shell-consistency | 5 | the five-family FAB class carriers → single-instance .chief-fab; "close returns" → Minimize collapse; the closed-state count-0 → hidden+count1 |
| chief-fab | 5 | .detail-fab → .chief-fab; 48×48/right504/bottom104 → 40×40@8 fixed (D4); the fab-avatar capture shape flipped to the closed-window state (fixture view drawer→none; the D4 mutual-exclusion capture face is inevitable) |
| chief-stream-markdown | 2 | F-R16/F-R18 add the entrance-animation settle predicate (fade+scale means boundingBox carries the transform); the 44px pill value unchanged (does not wrap on one line at 380 width, measured true) |
| detail-3pane | 1 | the 488/418 two-state composer width → single-state 488 + open-window zero-displacement contrast shot (D7 mutual exclusion retired) |
| chief-drawer-model | 1 | the closed-window-reclaimed popover count-0 → hidden carrier (the portaled overlay open-state count hits zero and the node count still returns to zero) |
| board-zoom-fit | 1 | the data-chief-open live-flip pin → open-window zero-floor-resurrection contrast shot (two-state retired) |

## 7. Build phase: probe repin zeroed (acceptance template v3 item 2)

`probe-repinned/`: after repin the chief domain 8 specs are all green, 93 cases, visual rows **KEPT 114 /
DRIFT 0 / NOT-RUN 0 / VIOLATION 0** (comparison table zeroed). The three-way diff chain:
`probe-pre-a0/` (start recon, old shell 104 KEPT) → `probe-after-a0/` (prototype state 52 KEPT /
5 DRIFT / 33 NOT-RUN = the repin work face) → `probe-repinned/` (zeroed). The human-review diff =
this volume's §3 classification table + §6 disposition table (all 5 DRIFT lines fall into "already-decided retired face", none suspected regression).

**Refresh after merging origin/main** (merge `520140f3`, bringing in #1004/#1034/#903/#1050):
the FAB ⌘J hint carrier migrates with #1004's kbd-hint retired face — that consumer site used to be the board-page inline button
(#1004 already flipped it to registry Tooltip+Kbd); A0 dropped the FAB into the root host `chief-root.tsx`,
and its form follows (Tooltip side=top + Kbd, not mounted at rest); the hotkeys wake-family hint pin
is repinned with the same carrier (after single-instance FAB, the "shared consumer site" semantics = the same route-independent carrier). This dump is
the post-migration rerun artifact (91→93 cases = main added 2 specs in-domain). After the merge the domain e2e is
191/191 green (including #1004's shadcn-primitives / sidebar-visual), web units 468/468,
typecheck / lint all green.

**Full batch (CI shards 2/3 exposed, 5 cases outside the domain set, fixed by `b12251ec`)**: 1 real regression =
#634 detail Esc layered guard queries any-mounted `[role=dialog]`, hit forever by the A0 resident window
→ the guard excludes `.chief-drawer` (the D3 window never owns the Esc key; detail-esc E1–E3 green). 4 carrier
repins = dead-buttons third-head button close→minimize (D3), notify-click T4b count-0→
hidden+count1 (D6), page-scroll wait-unmount→wait-present (settings-face in-window swap),
agent-identity-chip 24px geometry hits the D7 entrance scale → settle predicate (3x repeat green).
**Local full run closed at 848/848** (§0's old "826 green" figure was the pre-merge number, void).

## 8. Build phase: better-colors incremental measurement (acceptance template v3 item 3)

`measure-a0-colors.mjs` + `colors-a0.json`: the A0 new composite face = window chrome + the FAB family
(zero new token color values, all new combinations of existing slots). Both modes 14 pairs all pass: dark body 13:1 /
UI glyphs 7.18:1 / badge 8.14:1; light body 16.14:1 / UI 6.31:1 / badge 7.38:1;
FAB glyphs 16.14:1, ⌘J chip 10.73:1. The floors follow spec/22 §1.8 / the #950 precedent (body 4.5,
UI glyphs 3). The global palette is not re-measured (#988 both-mode 109 pairs 0 fail, closed).

## 9. Handwritten shell retirement reconciliation declaration (acceptance template v3 item 5, #983 verdict table item by item)

The #983 verdict rows that fall in the chief domain:
- **panel→Card / dialog-shell zero-skin / status-chip / tag-chip / seeded-avatar /
  kbd-hint→Tooltip+Kbd / floating-shell family split**: all **not in the A0 phase** (owned by #1008 L5 and
  wave 2 / build batches) — A0 touches none of them; the current consumer sites stay as-is (the seeded-avatar /
  kbd-hint / dialog-shell consumer sites in the chief domain keep their existing form). **One post-merge exception**: the board FAB's
  ⌘J hint consumer site has already been flipped by main's #1004 to registry Tooltip+Kbd; when A0 dropped that FAB into
  `chief-root.tsx` it **inherited the #1004 form** (not a new retirement made by this ticket; the full version still belongs to #1060/L5,
  this ticket does not touch the remaining kbd-hint consumer sites).
- **The F8 registry overlay items hard-coding z-50 single-point verdict**: ships with A0 (the tokens.css --z-floating
  annotation) — the rendered items ride --z-dialog through an already-registered deviation, the non-rendered items keep the upstream z-50 original text.
- **The dialog-shell flip cross (L3/#1006 review notice)**: rewind confirmed the layer is a regular dialog-shell
  consumer site; after L3 merges, follow the example (drop the self-carried padding, feed bare content into DialogFooter) — owned by
  the A0 build face and the #1006 merge-order coordination; this PR does not move (moving it would collide with current main).

## 10. Unmigrated residue declaration (acceptance template v3 item 6)

- Identifier residue: the `chief-drawer.tsx` file name / the `ChiefDrawer` component name / the `.chief-drawer`
  class hook (the hotkeys guard + e2e scope anchor) — recorded under ADR 0013 D13; renaming follows in a later build batch;
- `--chief-shadow` keeps a single consumer site in the drawer-header switcher popover (the floating window now rides --floating-shadow);
  `--dur-drawer` zero consumers (kept as the motion registry mirror); `--edge-radius`/`--radius-popover`
  still belong to the #983 retired face, pending approval;
- the A1 five-primitive vendoring staging at `/tmp/a1-primitives-1009/` (uncommitted, enabled after A0 merges);
- draft persistence across a full page refresh = #1056 (review decision 4, a separate ticket);
- registry anchoring (scrollAnchor) = review decision 2 rejected (keep the #873 follow rule).

## 11. The A1 phase prototype (chat primitive install + chief message stream dress swap)

> State: **the three review decisions are back (2026-10-08) → build phase done, PR #1066 CI greening**. A0 merged (squash `99ffb54a`, PR #1062).
> A1 scope (ticket): five-primitive install (MessageScroller/Message/Bubble/Attachment/Marker)
> + message stream swap + scroll model swap + row id threading + Bubble default-skin geometry neutralization;
> jump-to-latest comes in with the primitive (#991 Q6, shown to the review); the composer input area is out of range (#991 Q7).

### 11.1 Install chain (acceptance template v3 item 7)

`node scripts/ui-registry-refresh.mjs --items message-scroller,message,bubble,attachment,marker`
(shadcn@4.21.3 view → R1–R5 rewrite → biome normalize → snapshot ledger) — the five hashes are **byte-for-byte identical** to the start-recon
staging (/tmp/a1-primitives-1009/): ed1dd557 / dc60c69f / b6812e3f /
33d34435 / 59574fed. Lands in `components/ui/` + ledger `pristine` ×5 (35 entries = 26 registry
(19 pristine) + 9 adapters, frozen from d62bc480) → gate PASS (idempotent re-verify no change) →
COMPONENTS.md new-track registered 5 rows (30→35) → inventory gate 4/4 green.

### 11.2 The dress-swap face (structure mapping)

| Current face | After swap | Neutralization (consumer-site className/style, primitive file pristine zero-touch) |
|---|---|---|
| body div (overflow-y auto, bodyRef + useChatFollow) | `MessageScroller` Root/Viewport/Content/Item | Root `h-auto min-h-0 flex-1` (the primitive size-full's h-full would blow out the flex chain); Viewport carries the chief-body testid (the F-R6/R8 overflowY auto face = supplied by the primitive) |
| chief-stream div (px-17 pt-3.5) | Content + chief-stream testid | `block gap-0` (row spacing is left as row margin — the primitive flex gap-6 would double the row spacing) |
| row div (key=index) | Item (key/messageId = the source chief_message id) | inline style `content-visibility: visible` (the primitive auto would make offscreen rows jump layouts — probes/e2e drift with the scroll phase; at the 380px window's tens-of-rows scale, determinism > virtualization benefit) |
| user row bubble (BUBBLE_CLS div) | Message + MessageContent + `Bubble variant=secondary` + BubbleContent (chief-bubble testid migrates along) | the secondary tier --secondary base = the original slot (--secondary-foreground equals --foreground in both themes, measured on the #1002 palette); `border-0` (the primitive border-transparent eats 2px — the F-R16 44px pill canon); rounded-(--radius-popover)/px-3/py-2.5/leading-6/w-full (the 80% cap retired) |
| robot row bare text | Message + `Bubble variant=ghost` + BubbleContent | ghost tier p-0/bg-transparent/rounded-none = the bare-text face; w-full + leading-6 correction |
| note/error row (centered div) | `Marker` + MarkerContent (error carries role=alert two-segment face) | centered/12px/ink pinned to the current state |
| thinking/tool/streaming row | Message skeleton + existing row items (ThinkingRow/ToolActivityRow/LiveRow shared items untouched, A2 face) | the `.chief-msg` class carrier kept (the F-R19/R20 joint selectors) |
| gate/hero (inside the scroll area) | moved out of the scroll area (flex-none sibling) | the two faces only appear in the no-stream state — visually equivalent after the move |
| — | `MessageScrollerButton direction=end` (jump-to-latest, #991 Q6 comes in with the primitive) | children override = the repo ArrowDown glyph (new in the generator) + `t('滚动到最新')` sr-only (the pristine-face English literal does not enter the i18n ledger) |

**Scroll-rule mapping (#873 item by item → primitive mechanism, review decision 2 = no scrollAnchor)**:
bottom-detection threshold 80px = `scrollEdgeThreshold={80}` (same value as FOLLOW_THRESHOLD); window close disarms =
`autoScroll={open}` (same rule as the old active); open lands at bottom = `defaultScrollPosition="end"`;
thread switch lands at bottom = the threadTitle guard effect → `scrollToEnd()` (equivalent to the old resetDep);
send jumps to latest = `scrollToEnd()` inside wire.onSend (equivalent to the old requestFollow).
useChatFollow itself is kept (the detail-page conversation column = the A2-phase swap face, untouched this phase).

**Row id threading (ticket's "mapper view side")**: `ChiefStreamItem` robot/thinking/tool three kinds
extend `id?: string`; collectChiefStream's three projection points `id: m.id` (each row's source message is distinct, so direct projection
without collision; wire zero-touch — ADR 0011 seals the segment on the write side). Unit-test contracts synced (chief-segments
F2/F4/F6 toEqual include id, 7/7 green). fixture capture shape has no id → key falls back to index, Item has no
messageId (S10 pinned); live-face messageId pins belong to the build-phase e2e (the live-mock stub carries id).

**Provider split**: the Dialog shell (Root/Portal/Popup/aside) + `MessageScrollerProvider` lives
in the outer ChiefDrawer; the threadsOpen state is lifted (Root's onOpenChange Esc-handling needs to read/write it);
the whole-column window content sinks into ChiefDrawerInner (the hook face consumes useMessageScroller — a hook in the same component cannot read
its own render tree's context; the split point is exactly that).

### 11.3 Prototype-state ledger

- Domain e2e 24 specs: **247 green / 2 red** — both reds are repin-ledger (behavior assertion semantics unchanged):
  ① the hero face `chief-stream` count-0 → resident Content carrier (same D6 family: container resident, zero rows);
  ② XMON-102 "draft/empty face equal-height 60px" → **the #860 grow rule already superseded the fixed track** (the chief-drawer
  growCap:120 annotation original text "the XMON-102 fixed-height law is superseded"). Proof: before A1
  scrollHeight=120 while inline height='' — the grow side effect **never fired** on the fixture face due to hidden-mount timing (also found by building a worktree in the A0 state), so the XMON-102 pin was pinning an accidental face where the side effect never fired;
  A1's mount structure fires it for the first time = the rule's true face (draft face 120px top-capped + in-box
  scrolling). The build phase repins per the #860 semantics.
- Probe three-way chain: `probe-a1-pre/` (start baseline KEPT 119/140 rows) → `probe-after-a1/`
  **KEPT 115 / DRIFT 1 / NOT-RUN 3 / VIOLATION 0** — the four DRIFT+NOT-RUN rows all fall on
  that single XMON-102 test (the 304 assertion + its follow-ups 308–310); the rest of the geometry/skin rows are all KEPT
  (44px pill, row rhythm, chip geometry, avatar 24px value-by-value preserved).
- fixture smoke (`drive-1009-a1-smoke.mjs`): **19/19 PASS** (S1 structure/S2 neutralization/S3
  Bubble skin/S4 Marker/S5 hero+grow/S6 open-lands-bottom/S7 jump-to-latest three faces/S8 reopen-lands-bottom/
  S9 carrier conservation/S10 id face).
- Units 468 all green (chief-segments contract updated, 7/7); typecheck / lint clean.
- Screenshots: a1-01 thread face / a1-02 jump button surfacing / a1-03 reopen lands bottom / a1-04 hero+grow face /
  a1-05 identity chip face / a1-06 dark / a1-07 light.

### 11.4 Review decision points (shown to the scroll review)

1. **The jump-to-latest button form itself** (#991 Q6: deleting it is the only customization — the primitive default skin = the repo
   Button secondary/icon-sm tier, bottom-edge centered, surfaces on scroll-up / retires near the bottom): screenshot a1-02.
2. **The S8 criterion flip**: minimize + reopen = **lands at bottom to see the latest** (the chat universal rule, same as the old dock era).
   Measured finding: Base UI keepMounted closed state = `hidden` = display:none — the browser discards the scroll
   position, so the A0-claimed D6 "scroll survives" is physically unreachable on the minimize face (the A0 phase was the same, not evidenced on
   this face; the draft/thread state survival is unaffected). Multica's original form = opacity+inert resident, **not**
   display:none, which is why scroll truly survives. To truly preserve it we would need a different shell-layer closed-state carrier (beyond A1's range) — take "reopen
   lands at bottom" or open a shell-layer ticket, please decide.
3. **The #860 grow rule first fires on the fixture face** (the XMON-102 repin): the draft 6-row face composer 120px
   top-capped (a1-04) — repin per the already-decided #860 rule, or keep the fixed track (requires turning grow off on the fixture face),
   please confirm.

### 11.5 A1's unconsumed primitive faces (residue declaration pre-registered)

MessageAvatar/MessageHeader/MessageFooter/MessageGroup/BubbleGroup/BubbleReactions/
MarkerIcon/Attachment full family (B-phase consumers) — the avatar slot still goes through the recipes single-source span (the primitive carries a
built-in bg-muted/min-w-8 skin; neutralization cost > benefit, re-decided in A2); `scroll-fade-b`/`scrollbar-thin`/
`scrollbar-gutter-stable` are shadcn hosted-utility dead classes (not vendored in the repo, zero effect zero side effect).

### 11.6 Build phase (review decisions landed + CI greening, 2026-10-08/09)

**The three review decisions (user "all three follow your suggestion" + a hard criterion on the third)**:
① jump-to-latest adopts the registry default form; ② the reopen semantics adopt "reopen lands at the latest",
the Multica inert/opacity carrier opens a separate shell ticket **#1067** (the display:none physically-unreachable fact is written into the ticket,
this ticket does not do it); ③ XMON-102 repins to the #860 grow semantics, **the pinned value is the evidence-measured reading**
("pin whatever the screenshot shows", no estimated/theoretical constants allowed).

**G5 verdict red and registered deviation (bubble.tsx tinted tier)**: ui-drift-gate G5 caught, in a pristine file,
the upstream tinted tier's relative color `oklch(from var(--primary) …)` — it depends on --primary at runtime,
cannot be folded into a static token value, and #851 "colors go through semantic slots" has no exemption exit. Disposition = **do not mint a new token slot**
(the coordinator's explicit order: don't self-mint a slot when unsure; this disposition mints none): rewrite it as
`color-mix(in_oklch, var(--primary) p%, var(--card))` two-token mix per button.tsx's existing deviation precedent (the same file's upstream
secondary/muted hover parenthesized idiom), the ratio back-solved from the upstream L target values (base 0.93 light / 0.30
dark, hover 0.88 / 0.35) against the #988 measured token L values (card 0.9426/0.2553, primary
0.1706/0.9346): light 2%/8%, dark 7%/14%, all four faces |ΔL| ≤ 0.005. Ledger
bubble.tsx → **deviated** (the 8th registered deviation, reason carries the full derivation), hash re-frozen
`a1b3b663…`, registry gate + drift gate both PASS. Zero conflict with the #988 palette ledger (no token
value moved), zero conflict with the #1055 brand-ink verdict (text-foreground as-is, the ink slot not re-appropriated).
The tinted tier has zero consumers in this lane (A1 only eats secondary/ghost).

**Two repin-ledger landings (e2e)**:
- hero face `chief-stream` count-0 → resident Content carrier rule (same D6 family): container count-1 +
  zero Items + zero row carriers (the behavior semantic "hero face has no stream" unchanged).
- XMON-102 → renamed "composer grows with a restored draft to the six-line cap
  (#860 supersedes XMON-102)": drafted 120 / empty 60, **the value source = measured rendering**
  (smoke S5/S5b two rows recorded in result-a1-fixture-smoke.json, screenshots a1-04 / a1-01),
  the spec annotation states it is not a growCap constant estimate (the values happen to coincide with the measured result). overflowY auto kept on both faces.
- New **F-R23**: live-face row id threading pin — the four Items' data-message-id map one-by-one
  to the stub message ids (m1/m2/m3/m9, storage order); the fixture face defaults id to index (S10 already pinned).

**better-colors increment (template v3 item 3)**: the A1 new composite face = **zero** — the user bubble goes through the
secondary tier (--secondary existing slot, the A0 volume §8 already measured the same slot family in both modes), robot goes through ghost
(transparent base, no new pair), marker/jump button all existing ink slots; the tinted deviation color zero consumers not rendered, no measurable face.
So this phase does not re-measure (#988 global 109 pairs closed + the A0 increment 14 pairs unchanged).

**Close-out ledger**: local full e2e **849/849** (including the new F-R23; main in the same period merged the #1007 pages
big change — the full net caught zero interaction reds), root vitest **2251/2251 (206 files)**, typecheck /
lint / registry gate / drift gate / inventory all green, probe after repin
**KEPT 121 / DRIFT 0 / NOT-RUN 0 / VIOLATION 0** (probe-after-a1 rerun covers the prototype-state dump;
the three-way chain = probe-a1-pre baseline → prototype DRIFT 1 → build zeroed).

## 12. The A2 prototype (detail conversation column → MessageScroller, 2026-10-09)

Branch `hp/pacman/t-0239-1-l6-chief-1009` merged to origin/main (merge `cb655e29`,
with #1006 detail-b / #1010 select / #1037 / #1026 etc. 11 commits), prototype commit
`14be5ed4`. The remaining five wave-1 lanes (#1004–#1008) and #1010 have merged; this ticket is the frontier's only
unclosed ticket.

### 12.1 The dress-swap face (structure mapping)

| Current face | After swap | Neutralization (consumer site, primitive file pristine zero-touch) |
|---|---|---|
| `.chat-col` (`flex-col-reverse` + `overflow-y-auto` + `chatColRef`) | `MessageScroller` Root > Viewport (testid `transcript-col`) | Root `h-auto min-h-0 flex-1` (the primitive `size-full`'s h-full blows out the detail-center flex chain); Viewport carries the `chat-col` class and the 19/16/16/19 padding (detail-3pane's `colPadBottom` / detail-narrow's horizontal-scroll assertions read here) |
| `.chat-pin.mb-auto` (the column-reverse bottom pin) | `MessageScrollerContent` `block gap-0` | row spacing semantics stay in the row's own margin; the primitive default `flex gap-6` would double the row spacing |
| row (`key=index`, no anchor) | `MessageScrollerItem` (`key`/`messageId` = the source message id) | inline style `content-visibility: visible` (the primitive `auto` would make offscreen rows jump layouts; probes/e2e drift with the scroll phase) |
| `useChatFollow` (`reversed: true`) | Provider-native `autoScroll` + `defaultScrollPosition="end"` | threshold 80 = `scrollEdgeThreshold={80}` (same value as FOLLOW_THRESHOLD, same rule as A1) |
| `requestFollow()` (onSend) | the column's imperative handle `scrollToEnd()` | the page calls via `transcriptColRef`; Provider and consumer are different components (a hook can't read its own render tree's context) |
| — | `MessageScrollerButton direction="end"` (jump-to-latest) | comes in with the primitive (#991 Q6), children override to the repo ArrowDown + `t('滚动到最新')` sr-only |

**Row id threading (ticket's "mapper view side")**: `TranscriptItem`'s user / robot /
thinking / note / review five kinds extend `id?: string`; `mapTranscript`'s five projection points
`id: m.id` (synthesized rows like run / plan / tools groups have no id → key falls back to index). wire zero-touch
(ADR 0011 seals the segment on the write side).

**Scroll-rule mapping (#873 item by item → primitive mechanism, same rule as A1)**: bottom-detection threshold 80px =
`scrollEdgeThreshold`; growth only drags while the reader is at the latest end = the primitive `autoScroll`; open-column lands
at latest = `defaultScrollPosition="end"` (equivalent to the old hook `bind→scrollToNewest`); the reader's own
send always jumps to latest = `scrollToEnd()`.

### 12.2 Prototype-state ledger

- Domain e2e **120 green / 2 red** (11 specs: detail-3pane / detail-narrow /
  chat-type-measure / transcript-user-words / thinking-row-truncate / spec-flow /
  dead-buttons / attachment-strip / attachment-title / composer-paste /
  chief-panel / chief-stream-markdown)
- The two reds = carrier-repin ledger (behavior assertion semantics unchanged word-for-word, owned by the build phase):
  ① **spec-flow 2** "brief card scrolls with the stream" — the old column is `column-reverse` (scrollTop 0 =
     latest, the old end read with a negative top); after the swap it is a normal scroll container (latest = `scrollHeight`, oldest =
     0). The assertion semantics (brief card follows the stream, the oldest end at the column head, the latest end scrolls out of view) unchanged, only the coordinate convention flips.
  ② **chat-type-measure "turn boundary is air"** — the probe walks the agent row's
     `previousElementSibling`; the row is now embedded in a `MessageScrollerItem`, so the carrier needs one more level.
     Its assertion "the boundary is only air, no horizontal line" unchanged.
- Probe three-way diff (`probe-a2-pre` → `probe-after-a2`, same 8 specs): compared rows 83
  —— **KEPT 76 / DRIFT 1 / NOT-RUN 6 / VIOLATION 0**. The only DRIFT = spec-flow's
  scroll-convention row (the ① above); all geometry rows KEPT (column width / row box / typography / padding value-by-value unchanged).
- Screenshots: `a2-detail-confirm-17b.png` (confirm phase + brief card),
  `a2-detail-done-36.png` (done phase multi-turn session), rerun recipe in `shoot-a2.mjs`.

### 12.3 Pending review decisions

1. **Scroll-axis reversal** (`column-reverse` → normal container) — the visual contract unchanged (short session top-aligned,
   long session opens at the latest row, brief card follows the stream), but any custom script/e2e that drives the old coordinates must flip in sync.
   Please confirm acceptance.
2. **The jump-to-latest button lands in the detail column** (A1 only landed it in the chief window). The detail column is 712px wide and the content end
   is always visible; this button's benefit is yet to be judged; whether #991 Q6's "deleting it is the only customization" still holds on a wide column.
3. **`useChatFollow` itself retires** — the detail page is this hook's last consumer, so after A2 it becomes
   dead code (including `apps/web/test/chat-follow.test.ts`). The build phase plans to delete the whole item (#873 single-source
   rule carried by the primitive); to keep an observation window, please say so.

## 13. The B prototype (attachment face → registry Attachment card, 2026-10-09)

### 13.1 The dress-swap face

| Current face | After swap | Neutralization |
|---|---|---|
| `chat-markdown.tsx` AttachmentChip (`<a class="spec-chip …">` / `<Button>` + `SPEC_CHIP`/`SPEC_CHIP_IMG` utilities) | `overlay/attachment-card.tsx` single-source card (`Attachment` primitive + `AttachmentTrigger`/`Media`/`Content`/`Title`) | the `.spec-chip` family demotes to zero-rule hooks (hung on the trigger button) — spec-brief-card's `a.spec-chip`/`img.spec-chip-img` and chief-composer-tools' `.spec-chip` locator children survive as-is |
| `attachment-strip.tsx` in-flight placeholder card (`<Button>`/`<span>` chip + uploading badge) | the same card `state="uploading"` | the uploading badge switches to absolute positioning — an extra row would change the box and break the "settle with zero displacement" contract |
| settled chip (`AttachmentChip`) | the same card `state="done"` | root box `border-0`: the primitive 1px seam would make the root box 1px larger per side than the trigger button box (the placeholder reads root, the settled reads trigger → a 2px drop); after removing the frame, root ≡ trigger |
| thumbnail geometry (`SPEC_CHIP_IMG`: `max-h-40 max-w-full`) | primitive `AttachmentMedia` image tier (`aspect-square w-10 object-cover`) | the constant retires; the thumbnail comes from the primitive |

The three host faces (detail composer / new-task dialog / chief drawer composer) share `AttachmentStrip` → `AttachmentCard`; one change takes effect in all three faces.

### 13.2 Ledger

- Domain e2e **122 green / 0 red** (10 specs: attachment-strip / attachment-title / spec-brief-card / chief-composer-tools / composer-paste / dead-buttons / chief-panel / chief-stream-markdown / detail-3pane / transcript-user-words) — **no repin**: the `FM2` box-equality contract (placeholder box ≡ settled box) preserved by design
- Local full e2e **862/862 green**; web units 464/464
- Probe (`probe-after-b`, 7 specs): **KEPT 126 / DRIFT 0 / NOT-RUN 0 / VIOLATION 0**
- typecheck / lint / registry gate / drift gate / consumer-shape gate all green (consumer file count 212→213, new `attachment-card.tsx`)

### 13.3 Pending review decisions

1. **The card shape changes from compact chip to registry card** (thumbnail block + filename row). The geometry contract is untouched, but the look is clearly different — the `b-card.drawio.svg` figure + `b-after/` screenshots against `docs/verify/757/`. Please confirm the card shape adoption.
2. **The `.spec-chip` hook kept** (zero-rule class, not a skin) — to avoid one-shot carrier repins for spec-brief-card / chief-composer-tools. To fully purge these class names, a separate carrier repin is needed (not done this phase).
3. **The close point of #1009** — B is the last of the four serial phases; after B merges, #1009 is done and #1011/#1012 lift blocking. Per the coordinator: **this phase's PR and commit both carry no closing keyword** (the squash message is governed by the merge instruction), #1009 is closed by the coordinator after all four phases land. Confirm this criterion is correct and the build phase is released.