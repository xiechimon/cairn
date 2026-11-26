# Reuse inventory (cairn web)

> This file answers exactly one question: **before writing a new UI piece, look here first — can an existing one be used directly?**
> "What it looks like" (colors / font sizes / radii / shadows / motion / the visual spec of each piece) lives in `apps/web/DESIGN.md` and `docs/design/surfaces/`; this file governs "**what exists, where, and what to reuse**".
> Three machine gates keep it from rotting (`test/ui-reuse-inventory.test.ts`): every new-track piece must be registered, every piece in the inventory must really exist, and the old track's final state must hold (the `src/ui/` directory must not resurrect).

## 1. Single track (the old track is retired)

| Track | Location | State |
|---|---|---|
| **The only track** | `src/components/ui/` | **All new code lands here.** shadcn pieces + Base UI base (#410 ruling), with in-repo deviation records |
| ~~Old track~~ | ~~`src/ui/`~~ | **Deleted as a whole directory (#952)**: `chip`→`status-chip.tsx` (#942), `input`→`components/ui/input.tsx` (#944), the `dialog.css` form family → equivalent utility-class migration + the `dialog-shell.tsx` mechanism inlined (#952). Machine gates pin the directory against resurrecting |
| Overlay family | `src/overlay/` | Mounts on the shared shell (see section three); **never hand-roll OverlayMount + useEscClose** |

<!-- inventory:old-track-frozen -->
```text
```
<!-- /inventory:old-track-frozen -->

(The block above is the final-state list the machine gate reads: the old track is fully deleted and the list is permanently empty; the reappearance of the `src/ui/` directory is an error.)

## 2. New-track primitives (36)

<!-- inventory:new-track -->
```text
alert-dialog-shell.tsx   # shared base for confirm surfaces (delete confirm / discard-draft confirm), built on Base UI AlertDialog
alert-dialog.tsx
attachment.tsx           # shadcn Attachment family (Attachment/Media/Content/Title/Description/Actions/Trigger/Group): attachment card primitive (#1009 phase B attachment surface consumer; do not hand-write attachment boxes)
avatar.tsx               # shadcn Avatar family (Root/Image/Fallback/Badge/Group, Base UI base, upstream hairline ring intact); avatar consumers do not use the raw trio — go through seeded-avatar.tsx
badge.tsx                # count / label pill; the task-status semantic color family is in DESIGN.md
bubble.tsx               # shadcn Bubble family (Bubble/Content/Group/Reactions): chat-stream message bubbles (#1009 A1 chief message stream / A2 detail conversation column consumers); skinning goes through the variant tiers + neutralization at the consumer — do not invent background colors
button.tsx               # registry-same-source + in-repo semantic mapping (type=button default, data-variant/data-size observation points, #411); primary CTA = default tier (the brand tier is retired, #982/#991)
card.tsx
checkbox.tsx             # checkbox (registry-same-source + a one-piece zero-skin semantic mapping: indeterminate renders a dash, #952/#982); the row box = the consumer's label wrap; **do not place a bare `<input type="checkbox">`** — the browser's built-in box is a different family from the in-repo checkbox row
collapsible.tsx          # Base UI Collapsible (Root/Trigger/Content, registry-same-source): the registryDependency of trace.tsx; reach for Trace first when the disclosure is an activity line
context-menu.tsx         # Base UI ContextMenu in the dropdown-menu skin (MENU_SURFACE_CLS / MENU_ITEM_CLS): opens on right click or a 500ms touch long press at the press point; the Coordinator reply's press menu (copy / select text) on touch and narrow windows
dialog-shell.tsx         # shared dialog base (e2e vehicle = role=dialog accessible name + dialog-head/-body/-foot testids)
dialog.tsx
dropdown-menu.tsx        # in-repo semantic mapping: z goes through the single --z-dialog ladder (#733), Content exposes anchor (#454); open motion retimed to --ease-out-expo at 100ms (owner motion pick), close stays instant via motion.css [data-closed]
empty.tsx
field.tsx                # form row composition (FieldGroup/Field/FieldLabel/FieldContent/FieldError…): all form layouts use it, do not hand-arrange with div + space-y
input.tsx
input-group.tsx          # input composition piece (InputGroupInput/InputGroupAddon/InputGroupButton…): use it when a button/icon/prefix/suffix must live inside the input — do not stuff a bare Input into a homemade box
kbd.tsx                  # key-cap primitive (the ⌘K cap in doc body text); floating shortcut hints = Kbd inside TooltipContent (the official-site composition, #1008)
label.tsx                # form label primitive (used with field.tsx's FieldLabel; use directly for standalone label cases)
marker.tsx               # shadcn Marker family (Marker/Icon/Content, separator/border tiers): annotation rows inside the chat stream (system notes / separators, centered annotations); a failure row is never composed here — render `components/chat/notice-line.tsx` `NoticeLine` (C32)
message-scroller.tsx     # shadcn MessageScroller family (Provider/Root/Viewport/Content/Item/Button + useMessageScroller hooks): the single implementation of the chat-stream scroll container (autoScroll bottom-follow + jump-to-latest + messageId pass-through); do not hand-write overflow-y-auto conversation columns anymore
message.tsx              # shadcn Message family (Message/Avatar/Content/Header/Footer/Group): the chat-stream message row skeleton (avatar column + content column); row skinning belongs to bubble/marker
popover.tsx              # in-repo semantic mapping: z goes through the single --z-dialog ladder (#733); motion = upstream defaults (#991 Q9)
ring-spinner.tsx         # loading.dev Ring spinner (20% track + 16/62.8 arc, round cap, 800ms linear via .spin-ring; MIT attribution in spinner.NOTICE.md): a busy button puts it before its label with data-icon="inline-start" and stays disabled — the Button context sizes it (16px at sm, 20px at default); first page loads use skeleton.tsx instead
seeded-avatar.tsx        # avatar adapter layer (src picture > tinted initial seeded by name > fallback image when there is no name; a broken picture falls back to the initial; Root is a fixed-size box, geometry via consumer className size-N, #983/#1003); always use it for avatars
select.tsx               # single-select dropdown (registry-same-source compound family: Select/SelectTrigger/SelectValue/SelectContent/SelectItem, #1010 re-sourced, the XMON-75 hand-written form retired; the clear tier = a SelectItem with value=null, geometry/anchoring left to Base UI Positioner defaults); **do not use the native `<select>` anymore** — it pops the system menu, and sitting next to homemade popups that is two popup systems
separator.tsx            # semantic divider (registryDependency of field.tsx): replaces <hr> and border-t divs
skeleton.tsx             # first-load placeholder drawn in the card shape while data has not arrived; use it instead of a spinner or empty copy (no existing primitive covers this)
spinner.tsx              # upstream registry spinner (pristine, not used in product code — busy indicators use ring-spinner.tsx)
status-chip.tsx          # the five-state task-status chip (idle/plan/confirm/done/failed, skin = --chip-* token pairs); lands on badge.tsx, the state vehicle is data-tone; replaces the old-track ui/chip.tsx (#942)
switch.tsx
tabs.tsx                 # default/line tiers ride the upstream native data-[variant] mechanism + zero-chrome TabsIndicator pass-through (#644, keep-or-go belongs to #1009); the segmented/bare hand-written tiers are retired (#991), the segmented control skin = the SEG_* recipes in pages/parts.ts
textarea.tsx             # multi-line input (registry-same-source); **do not place a bare `<textarea>`** — the old .dlg-form-textarea family is retired
toaster.tsx              # toast primitive (sonner, the official shadcn recipe; #631): mount <Toaster /> once at the App root, then imperative `toast.*` anywhere; **do not build another silent catch for failure feedback** — exceptions/toasts always go through it
tooltip.tsx              # hover/focus info bubble (official-site form; z goes through the single --z-dialog ladder); the shortcut hint chip = the Tooltip+Kbd composition (#983 ruling, landed in #1008, kbd-hint.tsx retired); the App root already mounts a site-wide TooltipProvider (delay=0)
trace.tsx                # shadcn Trace family (Trace/Line/Icon/Title/Description/Collapsible/Trigger/Content): agent activity lines (tool calls, thinking, waiting) with status running/error/pending and a collapsible detail; do not hand-write tool-call rows in chat files
```
<!-- /inventory:new-track -->

**Upstream-same-source discipline (#989 canonical)**: `components/ui/` may only contain registry-same-source pieces + zero-skin adapter layers. Each piece's same-source state (pristine / deviated + reason) has the `scripts/ui-registry.json` hash ledger as its **single source of truth**, checked mechanically by the CI gate; re-pulling upstream goes through `node scripts/ui-registry-refresh.mjs` (CLI pin + R1–R5 rewrite + biome normalization), and **hand-editing a piece's contents to bypass the ledger is forbidden** — changing a piece without re-freezing the ledger turns the check job red.

## 3. Which one to use when

| Surface to build | Use | Do not |
|---|---|---|
| Button / icon button | `components/ui/button.tsx` | Do not write a new `<button>` + homemade classes |
| Input | `components/ui/input.tsx` | Do not place a bare `<input>` (except deliberate-native markings) |
| Multi-line input | `components/ui/textarea.tsx` | Do not place a bare `<textarea>` / do not keep using the old `.dlg-form-textarea` classes |
| Task-status chip (five states) | `components/ui/status-chip.tsx` | Do not write a new `.chip--*` class family (pinned by ui-drift-gate G3) |
| Switch | `components/ui/switch.tsx` | — |
| Tabs | `components/ui/tabs.tsx` | — |
| Count / label pill | `components/ui/badge.tsx` (the status color family) | The five task states go through `status-chip.tsx`; do not mix the two vehicles |
| Empty state | `components/ui/empty.tsx` | Do not hand-write an empty-state copy block per site |
| Confirm dialog | `components/ui/alert-dialog-shell.tsx` | Do not hand-roll `OverlayMount` + `useEscClose` |
| Regular dialog | `components/ui/dialog-shell.tsx` | Consumers only change the import path (the API is verbatim the same) |
| Anchored floating surface (dropdown / menu / popover) | `dropdown-menu.tsx` (menu family) / `popover.tsx` (panel family, cross-component anchoring via the Content's `anchor`) / `dialog.tsx` (centered modal family) | Do not build a homemade positioning shell (floating-shell.tsx was deleted with #1010) |
| **Single-select dropdown** (pick one value) | `components/ui/select.tsx` (registry compound family, #1010) | Do not use the native `<select>` (pops the system menu — two systems next to homemade popups), do not hand-write trigger-button + popup per surface |
| Checkbox | `components/ui/checkbox.tsx` | Do not place a bare `<input type="checkbox">` — the browser's built-in box is a different family from the in-repo checkbox row |
| **Resting box** (a card / settings block sitting still on a page) | `components/settings-list.tsx` (`SettingsCard` + `SettingsRow`; `CARD_RADIUS_CLS` for other card-like surfaces) | Do not start a new hand-written `.xxx-card` class — card skin is `bg-card` + `--radius-card` + `--e1` |
| Layout block (a container that wants its own skin) | `components/ui/card.tsx` (the shadcn layout shell; consumers self-override `ring-0` / `py-0` / radius) | Do not use it as a visual primitive — its `ring-1` + `rounded-xl` + `bg-card` mismatches in-repo needs; a real card is a per-face class family |
| **Avatar** | `components/ui/seeded-avatar.tsx` (picture, else the name's tinted initial, else the fallback image; sizes via SeededAvatar's `className="size-N"`, Root is a fixed-size box) | Do not use the `avatar.tsx` trio directly — the seed/fallback semantics would be copied apart |
| Form row composition | `components/ui/field.tsx` (FieldGroup + Field + FieldLabel) | Do not hand-arrange forms with `div` + `space-y-*` / `grid gap-*` |
| Input with button/icon | `components/ui/input-group.tsx` | Do not stuff a bare `Input` into a homemade composition box |
| Hover info bubble | `components/ui/tooltip.tsx` | — |
| Divider | `components/ui/separator.tsx` | Do not use `<hr>` / `border-t` divs |
| Shortcut hint chip | the `tooltip.tsx` + `kbd.tsx` composition assembled at the consumer (Kbd inside TooltipContent, the #1008/#983 ruling) | Do not hand-write absolute positioning + show/hide; the key caps in doc body text use `kbd.tsx` directly |
| **Toast / lightweight failure feedback** | `toast.*` (imperative; `components/ui/toaster.tsx` is already mounted at the App root) | Do not silently swallow mutation errors; **surfaces that already have an in-surface scoped red-line canon (XMON-80/P2) keep going in-surface and do not stack toast on top** |

The gallery `design.html` (`src/design/`) renders every piece above on the real tokens; open `/design.html` on the web dev server.
