# Reuse inventory (cairn web)

> Machine-checked primitive manifest for `apps/web/src/components/ui/` (`test/ui-reuse-inventory.test.ts`). Component choice lives in `apps/web/DESIGN.md` ("Which component to use"); visual specimens live at `/design.html`; upstream and deviation hashes live in `scripts/ui-registry.json` (`node scripts/ui-registry-gate.mjs`).

## 1. Retired old track

`src/ui/` was deleted in #952 and must stay absent. All primitives land in `src/components/ui/` (shadcn + Base UI) or `src/overlay/`.

<!-- inventory:old-track-frozen -->
```text
```
<!-- /inventory:old-track-frozen -->

## 2. Primitives (36)

<!-- inventory:new-track -->
```text
alert-dialog-shell.tsx   # confirm dialog base over AlertDialog (X/Esc/backdrop, focus restore)
alert-dialog.tsx         # pristine registry AlertDialog primitive
attachment.tsx           # shadcn Attachment family for attachment cards
avatar.tsx               # pristine registry Avatar; consumers use seeded-avatar.tsx instead
badge.tsx                # count / label pill (task status uses status-chip.tsx)
bubble.tsx               # shadcn Bubble family for chat-stream message bubbles
button.tsx               # primary CTA = default tier, type="button" default, flat press
card.tsx                 # pristine layout shell only; visual cards use SettingsCard or per-face classes
checkbox.tsx             # Base UI checkbox (indeterminate dash); never bare <input type="checkbox">
collapsible.tsx          # Base UI Collapsible (registryDependency of trace.tsx)
context-menu.tsx         # Base UI ContextMenu in dropdown-menu skin (right click / 500ms touch press)
dialog-shell.tsx         # shared dialog base (role="dialog", dialog-head/-body/-foot testids)
dialog.tsx               # pristine registry Dialog primitive
dropdown-menu.tsx        # anchored menu over --z-dialog ladder; open 100ms --ease-out-expo, instant close
empty.tsx                # empty state primitive (composed via components/empty-state.tsx)
field.tsx                # form row composition (FieldGroup / Field / FieldLabel / FieldError)
input.tsx                # text input; never bare <input> without deliberate-native
input-group.tsx          # input with inline icon, button, prefix or suffix
kbd.tsx                  # inline key cap (floating shortcut hints compose Tooltip + Kbd)
label.tsx                # standalone form label primitive
marker.tsx               # chat-stream annotation rows (failures use components/chat/notice-line.tsx)
message-scroller.tsx     # chat-stream scroll container (auto-scroll + jump-to-latest)
message.tsx              # chat-stream message row skeleton
popover.tsx              # anchored panel over --z-dialog ladder
ring-spinner.tsx         # busy indicator inside buttons and inline loading rows
seeded-avatar.tsx        # picture > name-tinted initial > fallback image; size via className="size-N"
select.tsx               # single-select dropdown; never native <select>
separator.tsx            # semantic divider; replaces <hr> and border-t divs
skeleton.tsx             # first-load placeholder in final card/row shape
spinner.tsx              # pristine registry spinner (unused; busy states use ring-spinner.tsx)
status-chip.tsx          # five-state task-status chip (data-tone + tokens)
switch.tsx               # registry Switch primitive (settings use components/toggle-switch.tsx)
tabs.tsx                 # Tabs primitive (consumers compose SegmentedTabs / SegmentedRadio)
textarea.tsx             # multi-line input; never bare <textarea>
toaster.tsx              # root <Toaster /> + imperative toastSuccess / toastError / toast.*
tooltip.tsx              # hover/focus bubble over --z-dialog ladder (root TooltipProvider delay=0)
trace.tsx                # agent activity line and collapsible detail (WorkTrace)
```
<!-- /inventory:new-track -->
