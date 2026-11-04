# #430 Popover behavior contract comparison (Base UI generation)

> A research sub-ticket of map #417 (repo-wide shadcn/ui rollout). `#410` ruled primitives = **Base UI**,
> while `#418`'s popover contract matrix (`docs/research/418-dialog-contract-matrix.md`, branch
> `research/dialog-contract`) was drafted against **radix Dialog semantics**. This ticket re-checks the same set of questions against Base UI's first-hand source
> and produces the executable mechanism comparison and wiring list for B1 (`#425`).
>
> Judgment columns: **equivalent** = Base UI ships it and the in-repo semantics agree; **needs wiring** = Base UI ships it but the semantics differ,
> or needs explicit passthrough; **missing** = Base UI has it but the repo does not (migration brings a behavior change); **repo-specific** = Base UI
> cannot express it directly and it must be kept.
>
> Evidence format `file:line`. Unverified items marked `[unverified]`.
> Package version: `@base-ui/react` **1.8.0** (`apps/web/package.json:19`, `pnpm-lock.yaml:579`).
> Comparison baseline: `docs/research/418-dialog-contract-matrix.md` (radix semantics).

## TL;DR

- **Exit-preserve-mount**: Base UI does not use radix's `Presence`. Unmounting is driven by a three-piece set of `useOpenStateTransitions`
  (`utils/popups/popupStoreUtils.mjs:404-444`) + `useOpenChangeComplete`
  (`internals/useOpenChangeComplete.mjs:19`) + `useTransitionStatus`
  (`internals/useTransitionStatus.mjs:15`), judged by
  **`Element.getAnimations()`** (`internals/useAnimationsFinished.mjs:74,79`) —
  both animation **and** transition are recognized, radix's `only recognizes animation` limitation does not exist.
  The public callback `onOpenChangeComplete(open)` fires in both the open and close directions, and fires even with no animation.
  The in-repo `exit period does not unmount` needs no extra wiring: Base UI ships the kept-mount on its own; the repo only needs to let the popup
  hold a transition to bridge the unmount window (`ui/dialog.css:207-217`).
- **Esc layering**: listening is at the **document bubble phase** (`floating-ui-react/hooks/useDismiss.mjs:458`),
  but the Dialog family uses a simpler gate — **only the innermost layer registers the listener** (`escapeKey: isTopmost`,
  `dialog/root/useDialogRoot.mjs:21,71`). The effect is the same innermost-first as radix's layer stack,
  but there is **no public `bubbles` prop** (`hasBlockingChild` is the Menu-family path, not the Dialog family).
  radix's `onEscapeKeyDown` has no counterpart: interception switches to `onOpenChange`'s second argument
  `eventDetails.cancel()` / `allowPropagation()`.
- **Focus return**: `Dialog.Popup` only takes `initialFocus` / `finalFocus`
  (`dialog/popup/DialogPopup.d.ts`), **no `initialFocusRef` / `finalFocusRef`**.
  Base UI by default **auto-returns to the trigger, no ref needed** (`FloatingFocusManager.mjs:458-479`);
  the in-repo trigger button lives outside the dialog tree, so it passes `finalFocus` a function that calls `focus()` itself and returns
  `void` to take over (`dialog-shell.tsx:81-94,147`) — simpler than radix's
  `onCloseAutoFocus` + `preventDefault()`, **no need to block the default behavior**.
- **Equivalent surfaces**: scrim/outside-press/controlled/three close paths/nested ordering mostly switch directly; **body scroll lock and focus trapping
  reverse from `#418`'s `missing` judgment to `Base UI ships it`** (modal's `useScrollLock` +
  `FloatingFocusManager` trap). Extra wiring needed is in §4.3.
- **`tw-animate-css` is not a required dependency, and is currently not wired at all**: it is in `apps/web/package.json:30`
  and `pnpm-lock.yaml:2870`, but the repo has **no `@import "tw-animate-css"`**; and
  `animate-in` / `animate-out` / `fade-in-0` / `zoom-in-95` **are not Tailwind v4 core utilities**
  (measured Tailwind 4.3.3 zero output, see §5). The `data-open:animate-in …` class strings in 6 files are
  **inert**, and the exit animation is actually carried by the repo's own CSS. Two options: delete the dependency, or wire the import.

## 1. Exit-preserve-mount

### 1.1 Mechanism comparison

| Dimension | radix (#418 conclusion) | Base UI 1.8.0 | Evidence |
|---|---|---|---|
| Unmount driver | `Presence` | `useOpenStateTransitions` + `useOpenChangeComplete` + `useTransitionStatus` | `utils/popups/popupStoreUtils.mjs:404-444`; `internals/useOpenChangeComplete.mjs:19`; `internals/useTransitionStatus.mjs:15` |
| Judgment basis | reads `getComputedStyle().animationName`, **only recognizes animation** | `Element.getAnimations()`, **animation + transition both recognized** | `internals/useAnimationsFinished.mjs:74,79` |
| Completion callback | internal `onAnimationComplete` (no public surface) | public `onOpenChangeComplete: (open: boolean) => void` | `dialog/root/DialogRoot.d.ts:44`; `popover/root/PopoverRoot.d.ts:33`; `menu/root/MenuRoot.d.ts:56` |
| Trigger timing | exit-animation end | **both open and close directions**; **no animation also fires** | open: `dialog/popup/DialogPopup.mjs:49-53`; close: `utils/popups/popupStoreUtils.mjs:428`; no-animation guarantee: `internals/useOpenChangeComplete.d.ts:27` verbatim "or there is no animation" + `useAnimationsFinished.mjs:74-77` |
| Data attributes | `data-state="open\|closed"` | `data-open` / `data-closed` / `data-starting-style` / `data-ending-style` | name canonical `utils/CommonPopupDataAttributes.mjs:6,11,16,21`; mapping `internals/stateAttributesMapping.mjs:9-19` |
| Forced keep-mount | `forceMount` (on Portal / Overlay / Content) | `Portal.keepMounted` (default false); imperative `actionsRef.unmount()`; `eventDetails.preventUnmountOnClose()` | `dialog/portal/DialogPortal.d.ts:17-21`, `.mjs:20,27,28`; `dialog/root/useRenderDialogRoot.mjs:63-66`; `dialog/store/DialogStore.mjs:31-34` |

The three keep-mount paths' respective semantics (this repo needs **none** of them, recorded for reference):

- `Portal.keepMounted`: after close the node stays in the DOM, hidden via `hidden={!mounted}` (`dialog/popup/DialogPopup.mjs:72`).
- `actionsRef.current.unmount()`: `dialog/root/DialogRoot.d.ts:51-57`, the comment requires `call it after the externally-controlled close animation ends`.
- `eventDetails.preventUnmountOnClose()`: called inside `onOpenChange`, it makes `useOpenStateTransitions`'s
  `enabled` condition miss → `forceUnmount` does not run → `mounted` stays true
  (`utils/popups/popupStoreUtils.mjs:430-431`). In this case `onOpenChangeComplete(false)` **does not fire**.

Note: Dialog / Popover / Menu **Roots have no `keepMounted` prop**, that name belongs only to each of their `Portal`s.
`keepMounted` has same-name props elsewhere on `Tabs.Panel` / `Accordion.Panel` / `Menu.RadioItemIndicator`
(`tabs/panel/TabsPanel.d.ts:36` etc.), not part of the popover family.

### 1.2 How `exit period does not unmount` lands in this repo

Base UI ships the kept-mount on its own, so the repo **no longer needs** the `useOverlayMount` JS-timer stack (un-migrated surfaces excepted).
The migrated surfaces' recipe is three things (`ui/dialog.css:207-217`):

```css
.dlg-shell { transition: visibility 0s linear var(--dur-overlay); }  /* hold the unmount window */
.dlg-shell[data-ending-style] { visibility: hidden; }                /* flip the end state */
.dlg-shell[data-ending-style] .anim-fade { opacity: 0; }             /* child exit visual */
```

**Key fact: `getAnimations()` defaults without `subtree`, only looking at the popup element's own animation.**
The subtree's exit transitions are invisible to Base UI (the `ui/dialog.css:228-229` comment already records this).
So `holding the unmount window` must be carried by the popup's own one transition or animation — the repo's `.dlg-shell`
`visibility 0s linear var(--dur-overlay)` line plays that role: when the property flips from `visible` to `hidden`
a CSSTransition is created per the CSS transition spec (with a non-zero delay), and Base UI waits for it to be `finished` before `forceUnmount`.

`--dur-overlay` = **200ms** (`styles/tokens.css:19`), matching `#425`'s measured unmount moment of 209ms.

The same recipe's migrated surfaces (hard class names matched one by one):

| Surface | window-holding transition + `[data-ending-style]` end state | File |
|---|---|---|
| `DialogShell` default state | `.dlg-shell` | `ui/dialog.css:207-217` |
| `DialogShell` viewport-root state (⌘K) | `.dlg-viewport` | `ui/dialog.css:230-248` |
| `search-panel` scrim | `.search-scrim` | `overlays/overlays.css:26` |
| `more-menu` | `.more-menu-shell` | `overlay/overlay.css:446,452,456` |
| `mention-picker` | `.mention-picker-shell` | `overlay/mention-picker.css:275,279` |
| `chief-model-select` | `.chief-model-shell` | `chief/chief.css:611,615` |

`AlertDialogShell` (`alert-dialog-shell.tsx:60,67`) and the `FloatingShell` surfaces each follow their own surface's
`anim-fade` / `anim-pop` end-state rules. **New surfaces must write this three-piece set**, otherwise the exit vanishes instantly with no error (see §8).

### 1.3 Un-migrated surfaces

The 12 files still on the old stack use `useOverlayMount` + `motion.css:52-56`'s
`[data-overlay-state="closed"]` + `setTimeout(exitMs)` (`overlay/use-overlay-mount.ts:22-52`).
The two mechanisms are isolated by DOM subtree, no conflict. Per-surface list in §4.4.

## 2. Esc layering

### 2.1 Mechanism comparison

| Dimension | radix (#418 conclusion) | Base UI 1.8.0 | Evidence |
|---|---|---|---|
| Listen position | `ownerDocument` **capture** phase | `ownerDocument` **bubble** phase | `floating-ui-react/hooks/useDismiss.mjs:458` (`addEventListener(doc, 'keydown', …)` with no third arg; outside-press in the same function all carry `capture: true`) |
| Who registers | layer stack: only `isHighestLayer` registers | Dialog family: **the outer layers do not register at all** (`escapeKey` false hangs no listener) | `dialog/root/useDialogRoot.mjs:21` (`isTopmost = ownNestedOpenDialogs === 0`), `:71` (`escapeKey: isTopmost`); `useDismiss.mjs:458`'s `escapeKey && …` |
| Nested ordering | layer stack automatic | innermost-first, same gate | count maintenance `dialog/root/useDialogRoot.mjs:19-20,77-96` |
| Event propagation | `preventDefault()` on hit | `preventDefault()` on hit; **by default also `stopPropagation()`** | `useDismiss.mjs:106-109` |
| Interception hook | `onEscapeKeyDown` | **no counterpart prop**; use `onOpenChange(open, eventDetails)`'s `eventDetails.cancel()` | `onEscapeKeyDown` 0 hits repo-wide; `internals/createBaseUIEventDetails.mjs:20-43`, `.d.ts:41-63`; consumption order `dialog/store/DialogStore.mjs:40-43` |
| `bubbles` prop | no such concept | **not a public prop**, only inside `useDismiss`; Menu derives it from `closeParentOnEsc` | `useDismiss.mjs:22-27,55-58`; `menu/root/MenuRoot.mjs:343-347`, `:45`; `menu/root/MenuRoot.d.ts:72-77` |

The Menu family has a separate layering: `hasBlockingChild('__escapeKeyBubbles')`
(`useDismiss.mjs:75-79,99`) + `FloatingTree` (`useDismiss.mjs:50`,
`floating-ui-react/components/FloatingTree.mjs:74`). **The Dialog family does not go this way**;
if `#418` described Dialog nesting via `hasBlockingChild`, it mis-planted it.

### 2.2 How the repo aligns with #318

`#318`'s semantics are `Esc closes the innermost first; with a dirty form the dialog layer does not close, only the confirm layer opens`. Base UI solves the former,
the latter the repo must take over itself. The landing point is `dialog-shell.tsx:122-134`:

```tsx
onOpenChange={(next, details) => {
  if (next) return;
  if (details?.reason === 'escape-key' && onEscapeWhileNested != null) {
    onEscapeWhileNested();          // innermost-first: hand to the consumer to decide which layer closes
    return;
  }
  if (onEscapeWhileNested != null && details?.reason === 'outside-press') {
    return;                          // while the inner layer is open, outside-press does not close self
  }
  onClose();
}}
```

**Cross-generation mixing is the sole reason this gate exists**: Base UI `stopPropagation()`s at the document bubble phase
(`useDismiss.mjs:106-109`), and `window` is the last stop on the bubble path, so
**an un-migrated surface's `useEscapeClose` listener hung on `window` never receives that keypress**
(the `dialog-shell.tsx:61-64` comment records this). If the inner layer is still the old stack, the shell must relay via
`onEscapeWhileNested`.

Conversely: **between migrated surfaces** (`DialogShell` ↔ `FloatingShell`), nesting is auto-layered by Base UI's
`isTopmost`, needing no in-repo code. `#418` judged `after migration the in-repo Esc effect must be deleted,
otherwise one Esc closes two layers across levels` — that risk does **not** hold for the all-migrated combination, and **still** holds for the mixed combination (see §8.1).

`newtask-project-select.spec.ts:74-82` (layered Esc: first press closes the popover, second closes the dialog)
and `:84-89` (outside-press closes only the inner layer) are this contract's e2e canonical, `#425` re-run green.

### 2.3 Esc-related reason literals

`onOpenChange`'s second argument is `eventDetails` (containing `reason`), **not** radix's standalone `reason` string.

| Component | Declaration site | Members |
|---|---|---|
| Dialog | `dialog/root/DialogRoot.d.ts:85` | `trigger-press` \| `outside-press` \| `escape-key` \| `close-press` \| `focus-out` \| `imperative-action` \| `none` |
| Popover | `popover/root/PopoverRoot.d.ts:84` | the above + `trigger-hover` \| `trigger-focus` |
| Menu | `menu/root/MenuRoot.d.ts:111` | 13 items, including `list-navigation` / `item-press` / `sibling-open` / `cancel-open` |
| AlertDialog | `alert-dialog/root/AlertDialogRoot.d.ts:33` | `= DialogRoot.ChangeEventReason` (direct alias) |

The literal canonical is `internals/reason-parts.mjs`; reason → native event type mapping
`internals/createBaseUIEventDetails.d.ts:3-37` (`escape-key: KeyboardEvent` at `:27`).
`eventDetails` also carries `cancel()` / `allowPropagation()` / `isCanceled` /
`isPropagationAllowed` / `trigger`, and Dialog/Popover/Menu/AlertDialog/Tooltip add
`preventUnmountOnClose()`.

## 3. Focus return

### 3.1 Entry: `initialFocus`

`Dialog.Popup` only takes two focus props (`dialog/popup/DialogPopup.d.ts`):

```ts
initialFocus?: boolean | React.RefObject<HTMLElement | null>
             | ((openType: InteractionType) => boolean | HTMLElement | null | void);
finalFocus?:   boolean | React.RefObject<HTMLElement | null>
             | ((closeType: InteractionType) => boolean | HTMLElement | null | void);
```

**There are no `initialFocusRef` / `finalFocusRef` prop names** — a ref is fed directly to `initialFocus` / `finalFocus`.
(The identifiers `initialFocusRef` / `finalFocusRef` only appear inside the package as local variables in an official doc example,
see `docs/react/components/dialog.md:1500-1513`: `initialFocus={initialFocusRef}`.)
`InteractionType` = `mouse | touch | pen | keyboard`.

Default: `interactionType === 'touch' ? popupRef.current : true`
(`utils/popups/popupStoreUtils.mjs:27-29`; the Dialog side resolves at `dialog/popup/DialogPopup.mjs:55`) —
on touch-open focus the popup itself to dodge the soft keyboard, otherwise go `the first tabbable inside the popup`.

`Popover.Popup` has the same shape (`popover/popup/PopoverPopup.d.ts`).
`Menu.Popup` has **no public `initialFocus` prop**: it computes internally by `parent.type !== 'menu'`
(`menu/popup/MenuPopup.mjs:110`), the destructured public props only being `finalFocus` (`:24-30`).

**Repo status: `initialFocus` not wired.** The entry target is inferred by Base UI's `first tabbable inside the popup`.
`newtask-single-field.spec.ts:65` (`.new-task-spec` `toBeFocused`) and
`hotkeys.spec.ts:121` hit it in measurement, `#425` green. This is an **implicit contract**: dependent on the panel's DOM order,
changing the structure (or prepending a tabbable to the panel) silently swaps the entry target, with no assertion alarm.
`#418`'s `the default first-tabbable ≠ the repo's target element, must write `onOpenAutoFocus`` —
its Base UI counterpart action is to wire `initialFocus`; the repo passed e2e by `not wiring, letting the default happen to hit`.

### 3.2 Return: `finalFocus`

`finalFocus` passes straight to `FloatingFocusManager`'s `returnFocus`
(`dialog/popup/DialogPopup.mjs:91`). The resolution implementation is in
`floating-ui-react/components/FloatingFocusManager.mjs:458-479`:

- `false` → do not move focus; `undefined` → return `null`, **do not move focus**
- `null` → fall back to the default
- `true` / boolean → return to the default element (**the trigger or the element focused before open**)
- `RefObject` → focus after `resolveRef`
- function → called with `closeType`, the return value resolved as above

**Default auto-returns to the trigger, no explicit ref needed**: `domReference` (`FloatingFocusManager.mjs:131`) is synced from
`activeTriggerElement` (`floating-ui-react/hooks/useSyncedFloatingRootContext.mjs:27,54-56`),
and `getReturnElement` (`FloatingFocusManager.mjs:458-479`) takes
`domReference?.isConnected ? domReference : null` when `returnFocus === true`.
radix's `no Trigger then return fails, focus lands on body` problem is mitigated in Base UI by the two-tier fallback
`elementFocusedBeforeOpen` / `getPreviouslyFocusedElement()` (in the same function).

**A trigger outside the React tree** has the official expression `Dialog.createHandle()`: render `<Dialog.Trigger>`
outside the Root, both ends passing the same `handle` (`dialog/store/DialogHandle.d.ts:4-8`;
the doc example starts at `docs/react/components/dialog.md:3442`).
**There is no `pass an arbitrary external DOM element as the trigger` prop**
`[unverified: searched handle / attachStore / triggerElements, no public entry that injects an arbitrary Element directly was found]`.

### 3.3 The repo's approach

Trigger buttons are all outside the dialog tree (`.sidebar-new-task`, card branch icons…), so the repo does not rely on Base UI's
trigger inference; instead it passes `finalFocus` a function that focuses itself (`dialog-shell.tsx:81-94,147`):

```tsx
function useReturnFocus(open: boolean) {
  const origin = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) return;
    const el = document.activeElement;
    if (el instanceof HTMLElement && el.closest('[data-slot="dialog-content"]') == null) {
      origin.current = el;          // in the closed state keep recording `the last active element outside the layer`
    }
  });
  const restore = useCallback(() => { origin.current?.focus(); }, []);
  return { restore };
}
// <DialogPrimitive.Popup finalFocus={restore} …>
```

`restore` is **a function returning `void`** — per §3.2's resolution rules, `undefined` means `do not move focus`,
the focus movement is done entirely by the repo's own function. **Therefore radix's
`onCloseAutoFocus={e => e.preventDefault()}` to block the default behavior is not needed**: on Base UI's side no default behavior
is triggered at all. This is the one of the three mechanisms that becomes **simpler** after the generation switch.

e2e canonical: `newtask-single-field.spec.ts:74` (after Esc `.sidebar-new-task` `toBeFocused`),
`overlay-focus.spec.ts:38-63` (after Esc reads `document.activeElement`'s focus-ring color),
`hotkeys.spec.ts:121`. The contract statement is at `overlay-focus.spec.ts:42`:
`#389: family law = focus enters the layer on open, returns to the trigger on close`.

`new-task-dialog.tsx:129-136,167-177` has another path of synchronous return + effect fallback
(comment: effect-return may lag behind the immediately-following assertion read under load).

### 3.4 Focus trapping and scroll lock

The config entry is `FloatingFocusManager` (`floating-ui-react/components/FloatingFocusManager.d.ts`):
`disabled` / `initialFocus` / `returnFocus` / `restoreFocus` / `modal` / `closeOnFocusOut`.
Defaults `initialFocus = true, returnFocus = true, restoreFocus = false, modal = true,
closeOnFocusOut = true` (`FloatingFocusManager.mjs:114-122`).

Per-shell actual arguments:

| Shell | modal | Result |
|---|---|---|
| `DialogShell` (`dialog-shell.tsx:135` passes `modal`) | `true` | trap on, scroll lock on, background aria-hidden |
| `FloatingShell` (`floating-shell.tsx:52` passes `modal={false}`) | `false` | no focus trapping, no backplate, no scroll lock |
| `AlertDialogShell` | Base UI forces `true` (`dialog/root/useRenderDialogRoot.mjs:27`) | same as DialogShell |

- Trap and background isolation use focus guard + `markOthers` (aria-hidden / inert):
  `FloatingFocusManager.mjs:338-349,557-590`.
- Scroll lock: `dialog/root/useDialogRoot.mjs:73` `useScrollLock(open && modal === true, popupElement)`.
- `modal: 'trap-focus'` is a third tier: traps focus but does not lock scroll nor block outside pointer
  (`dialog/root/DialogRoot.d.ts:29-36`).

## 4. Equivalent surfaces and extra-wiring list

### 4.1 Comparison matrix

| # | Behavior | Base UI 1.8.0 | Repo status | Judgment |
|---|---|---|---|---|
| 1 | Esc close / layering | Dialog family `escapeKey: isTopmost` (`dialog/root/useDialogRoot.mjs:21,71`), innermost-first automatic | between migrated surfaces automatic; cross-generation mixing relayed by the shell via `onEscapeWhileNested` (`dialog-shell.tsx:126-129`) | **equivalent** (all-migrated) / **needs wiring** (mixed) |
| 2 | scrim click close | `outside-press` built in; reason `outside-press`; closability controlled by `disablePointerDismissal` (default false) | the shell additionally hangs Backdrop `onClick={onBackdropClick ?? onClose}` (`dialog-shell.tsx:142`) | **equivalent** (same behavior); the **dual channel** needs attention (see §4.2) |
| 3 | panel-inner click does not close | built in | same | **equivalent** |
| 4 | body scroll lock | **built in**: `useScrollLock(open && modal === true, …)` (`dialog/root/useDialogRoot.mjs:73`) | DialogShell/AlertDialogShell on; FloatingShell (`modal={false}`) off | **missing → reversed to built-in** (`#418`'s `missing` judgment voided) |
| 5 | focus trapping / Tab wrap | **built in**: `FloatingFocusManager` trap + guards (when `modal=true`) | DialogShell/AlertDialogShell on; FloatingShell off | **missing → reversed to built-in** (`#418`'s `missing` judgment voided) |
| 6 | focus enters the layer on open | default first tabbable inside the popup; focus the popup itself on touch | **`initialFocus` not wired**, relies on the default hitting by luck (e2e green) | **needs wiring** (implicit contract, see §3.1) |
| 7 | focus return after close | default auto-returns to the trigger (`FloatingFocusManager.mjs:458-479`) | explicit `finalFocus={restore}` function takes over (`dialog-shell.tsx:147`) | **equivalent** (and one fewer `preventDefault` step than radix) |
| 8 | `role` / aria-label | default `role='dialog'` (store value) | `:161` explicitly gives `role` (`presentation` on viewportRoot), `:162` `aria-label={title}`. `:158-160` comment explains why the two states each give a real value (`mergeProps`'s `for...in` overwrites the store default with `undefined`) | **equivalent** |
| 9 | `aria-modal` | **package-wide never writes this attribute** (the only two hits are `toast/root/ToastRoot.mjs:419` writing `'aria-modal': false`). Background isolation instead uses `markOthers`'s aria-hidden | the old shell once wrote `aria-modal="true"`; on migrated surfaces **this attribute has disappeared** | **needs wiring** (semantics carried by aria-hidden) |
| 10 | controlled semantics | `open` / `defaultOpen` + `onOpenChange(open, eventDetails)` (`dialog/root/DialogRoot.d.ts:14-25,40`) | `open` + `onClose` one-to-one mapping (`dialog-shell.tsx:120-134`, `floating-shell.tsx:50-55`) | **equivalent** |
| 11 | nested ordering | `isTopmost` (Dialog) / `FloatingTree` + `closeParentOnEsc` (Menu) | same as 1 | **equivalent** |
| 12 | animation hooks | `data-open` / `data-closed` / `data-starting-style` / `data-ending-style` (`utils/CommonPopupDataAttributes.mjs:6,11,16,21`); also `data-nested` / `data-nested-dialog-open` (`dialog/popup/DialogPopupDataAttributes.mjs:22,26`), Popover/Menu's `data-instant` | the original CSS only uses `[data-ending-style]` (§1.2 six sites); the Tailwind variant class strings `data-open:animate-in …` are **inert** (§5) | **needs wiring** (recipe in §1.2) |
| 13 | `#193` short-viewport capping three-segment law | no counterpart (Base UI does not manage geometry) | `dialog-shell.tsx:151`'s `max-h-[calc(100vh-48px)]` + `.dlg-body` self-scroll + `.dlg-foot` | **repo-specific** |
| 14 | stacking / hit-test | `Portal` landing decides the containing block | the shell uses a `zIndex` argument (`dialog-shell.tsx:140,154`); `FloatingShell` uses `container` to hang the portal back on the anchor wrap and keep the `position:absolute` containing block (`floating-shell.tsx:37,57`) | **needs wiring** (already wired) |
| 15 | three close paths (X / Esc / backdrop) | `Dialog.Close` (`dialog/close/DialogClose.mjs:39`) + outside-press + escape | X = `DialogPrimitive.Close` + `onClick={onClose}` (`dialog-shell.tsx:177-183`) | **equivalent** |
| 16 | `AlertDialog` semantics | **not an independent implementation**, a mode of Dialog: forces `modal=true`, forces `disablePointerDismissal=true`, `role='alertdialog'` (three lines, `dialog/root/useRenderDialogRoot.mjs:26-29`). **Esc is not blocked** | `alert-dialog-shell.tsx:49,62` **reconnects** Esc and the backplate (the old-shell confirm face's contract is three paths all closable) | **equivalent** (needs explicit wiring, already wired) |
| 17 | focus-ring canon | none (Base UI does not manage skin) | the repo's `#388` canon, carried by className | **repo-specific** |
| 18 | scrim color / radius / shadow | none | `--overlay-scrim` / 12px / in-repo shadow token | **repo-specific** |

### 4.2 Two behavior differences worth naming

**(a) Backplate close is dual-channel.** The shell simultaneously has Base UI's outside-press and
`Backdrop onClick={onBackdropClick ?? onClose}` (`dialog-shell.tsx:142`).
Both channels fire on the one `click the backplate` interaction: Base UI goes through `onOpenChange`'s
`reason === 'outside-press'` branch, React's `onClick` goes through `onBackdropClick ?? onClose`.
The shell aligns the two by `swallowing `outside-press` when nested` (`dialog-shell.tsx:130-132`),
but **when not nested `onClose` gets called twice** — the benign duplicate call is harmless to an idempotent `setOpen(false)`,
but it would trip a new consumption site whose ``onClose` carries side effects`. Registered as a known shape.

**(b) `AlertDialog` does not block Esc.** The common assumption is `AlertDialog by default closes on neither Esc nor outside-press`.
Source fact: it only forces `disablePointerDismissal = true`
(`dialog/root/useRenderDialogRoot.mjs:28`), the Esc switch goes through `escapeKey: isTopmost`
(`dialog/root/useDialogRoot.mjs:71`), unrelated to `disablePointerDismissal`.
The package docs also list Esc as a close path (`docs/react/components/alert-dialog.md:687`).
The repo's `alert-dialog-shell.tsx:49` explicitly wiring `useEscClose` is a **redundant but harmless** hardening
(the old-stack semantics require it; keeping it preserves behavior).

### 4.3 Extra-wiring list

Compared item by item against `#418` §7's 10 items (**voided** items marked):

1. ~~install `radix-ui` / `class-variance-authority` / `clsx` / `tailwind-merge`~~ — **voided**.
   Now installed `@base-ui/react` 1.8.0 (`apps/web/package.json:19`). A new worktree still needs
   `pnpm install` before starting (this repo's `node_modules` is not committed).
2. ~~install `tw-animate-css` and change CSS animation~~ — **voided**. Base UI's `getAnimations()`
   recognizes transition too; and the repo currently has that package totally unwired (§5).
3. **Exit-preserve-mount**: Base UI ships it, no `forceMount` needed. The repo only needs to ensure the popup itself carries a
   transition / animation to bridge the unmount window (§1.2 three-piece set). New surfaces copy it.
4. **the `#193` three-segment law**: carried by className (`dialog-shell.tsx:151`, `ui/dialog.css`).
5. **`#389` return**: `finalFocus` passes a function (calls `focus()` itself, returns `void`); to pin the entry target,
   wire `initialFocus` (currently unwired).
6. ~~`onEscapeKeyDown`~~ — use `onOpenChange`'s `eventDetails.cancel()` /
   `allowPropagation()`.
7. **aria**: `aria-modal` disappears on migrated surfaces, the semantics carried by `markOthers`'s aria-hidden;
   the title still goes through `aria-label={title}` (`dialog-shell.tsx:162`).
8. **skin per-value overrides**: carried by className / `ui/dialog.css`.
9. **stacking**: the `zIndex` argument + `Portal container` (`floating-shell.tsx:37`).
10. **class anchors**: `className` passthrough keeps `.dlg*` / `.overlay*` / `.new-task-*` etc. spec-locating anchors.
11. **cross-generation mixing** (not in `#418`): old-stack surfaces' Esc / outside-press must be relayed by the shell's
    `onEscapeWhileNested` (§2.2).
12. **cleanup items** (not in `#418`):
    - `--exit-ms` is an **orphan variable**: `overlays/dismiss.tsx:31` writes inline
      `--exit-ms` at every old-stack mount point, but **zero CSS reads it** (`motion.css:55` reads `var(--dur-fast)`).
    - `overlay/new-task-dialog.tsx:34` imports `useEscapeClose` but **no call in the whole file** (dead import).

### 4.4 Un-migrated surface list (12 files)

The old-stack three-piece set is **fully alive**, not dead code (`overlays/dismiss.tsx:16,51,66`):

| Primitive | Live consumption sites |
|---|---|
| `OverlayMount` | 8 files / 10 sites: `board/tag-filter.tsx:102`, `board/sidebar.tsx:263`, `pages/schedules-page.tsx:149,208`, `pages/dir-browser.tsx:118`, `pages/project-page.tsx:292`, `pages/project-new-page.tsx:408,454`, `chief/chief-drawer.tsx:148`, `overlay/new-task-dialog.tsx:279,398` |
| `useEscapeClose` | 8 files / 9 calls |
| `ClickCatcher` | 14 files / 16 sites |
| `useEscClose` (`overlay/use-esc.ts:13`) | 1 site: `components/ui/alert-dialog-shell.tsx:49` |

Two still-fully-hand-rolled surfaces: `detail/overlays.tsx:57` (rerun dialog / reuse-plan panel, with its own
`.overlay` + `window` keydown + `escMuted` inner-yield gate) and `overlay/token-gate.tsx:62`
(`.token-gate-backdrop` + `Card`, **no Esc**, the gate cannot be closed).

## 5. Skin and animation dependency: is `tw-animate-css` still required

**Conclusion: not required, and currently totally unwired.**

### 5.1 Evidence chain

1. Declaration exists: `apps/web/package.json:30` `"tw-animate-css": "^1.4.0"`, `pnpm-lock.yaml:2870`.
2. **No import**: `grep -rn '^@import' apps/web/src --include=*.css` has only two lines —
   `styles/app.css:1` `@import "tailwindcss"` and `:5` `@import "./shadcn.css"`.
   Repo-wide (except `package.json` / `pnpm-lock.yaml` / one comment) no `tw-animate-css` text.
3. **These are not core utilities**: measured (Tailwind **4.3.3**, same version as `pnpm-workspace.yaml:27`)
   compiling `<div class="flex animate-in animate-out fade-in-0 zoom-in-95 data-open:animate-in">`
   outputs only `.flex { display: flex }`; `animate-in` / `animate-out` /
   `fade-in-0` / `zoom-in-95` **zero output**.
4. The repo also has no equivalent definitions: `apps/web/src/styles/` has no `--animate-*` theme keys,
   the `@keyframes` are only `overlay-fade` / `overlay-pop` / `drawer-in` / `spinner-reel`
   (`motion.css:17,26,37,103`).

### 5.2 Consequence

The **11 sites / 6 files** citing these class strings (`dialog-shell.tsx:118,151`,
`alert-dialog-shell.tsx:60,67`, `dialog.tsx:28,50`, `alert-dialog.tsx:26,48`,
`popover.tsx`, `dropdown-menu.tsx`) **produce zero CSS**. The class names are inert.

The exit animation actually comes from the repo's own recipe (§1.2): `motion.css:67-70`'s
`.anim-fade { animation: overlay-fade var(--dur-overlay); transition: opacity var(--dur-overlay) }`
paired with `ui/dialog.css:215-217`'s `[data-ending-style] .anim-fade { opacity: 0 }`.
Base UI's `getAnimations()` recognizes transition, so this recipe works — **no animation library dependency**.

### 5.3 Two options

- **(a) Delete the dependency**: remove `apps/web/package.json:30` + `pnpm-lock.yaml`, and delete the 11 inert class strings
  (pure noise, misreading readers into thinking the animation is provided by them). Exit behavior zero change.
- **(b) Wire it**: add `@import "tw-animate-css";` in `styles/app.css`, making the base-nova official-shape
  animation really take effect. **Note this makes the existing `[data-ending-style]` recipe stack with tw-animate-css's
  `animate-out`**, two animations running at once, the unmount window taking the longer of the two.

Keeping the status quo (declared but unwired) is the only non-recommended option — it makes the `where does the animation come from` question unsolvable in code.

## 6. `#418` matrix rows voided by the generation switch

After `#410` ruled Base UI, `#418`'s following conclusions are **not directly executable**, this ticket prevails:

| `#418` row/section | `#418`'s claim | Base UI fact |
|---|---|---|
| §2.1 / matrix 1 | Esc relies on the layer stack, only the topmost hangs a **document capture** listener | document **bubble** (`useDismiss.mjs:458`); the Dialog family relies on `escapeKey: isTopmost` making outer layers **not register** (`dialog/root/useDialogRoot.mjs:21,71`) |
| §2.3 / matrix 5 | focus trapping `missing`, confirm whether to introduce | **built in** (`FloatingFocusManager` trap) |
| §2.4 / matrix 6 | the override point = `onOpenAutoFocus` | `initialFocus` (`dialog/popup/DialogPopup.d.ts`) |
| §2.5 / matrix 7 | `onCloseAutoFocus` + `preventDefault()` blocks radix's empty return | `finalFocus`; a `void`-returning function means `do not move focus`, **no blocking needed** |
| §2.8 / matrix 12 | `Presence` **only recognizes CSS animation**, transition always unmounts immediately | `getAnimations()` **recognizes both animation + transition** (`useAnimationsFinished.mjs:74,79`); attribute names `data-state` → `data-open`/`data-closed`/`data-starting-style`/`data-ending-style` |
| §2.9 / matrix 4 | body scroll lock `missing` | **built in** (`useScrollLock`, `dialog/root/useDialogRoot.mjs:73`) |
| §6 props table | `onEscapeKeyDown` / `onPointerDownOutside` / `onInteractOutside` / `onFocusOutside` / `asChild` / `forceMount` / `container` | respectively: **none** (use `eventDetails.cancel()`) / `disablePointerDismissal` / same / `closeOnFocusOut` / `render` / `Portal.keepMounted` / `Portal container` |
| §6 last paragraph | AlertDialog `Escape / outside-press default non-closing` | only blocks outside-press; **Esc not blocked** (`dialog/root/useRenderDialogRoot.mjs:27-29`) |
| §7 items 1, 2 | install `radix-ui`, install `tw-animate-css` | both voided (§4.3, §5) |
| §8 Premortem 1 | `one Esc closes two layers` because the in-repo window effect was not deleted clean | does **not** hold for the all-migrated combination; **holds** for the mixed combination (§2.2) |
| §8 Premortem 2 | `tw-animate-css` not installed → `animationName === 'none'` → Presence unmounts immediately | both the mechanism name and cause changed: Base UI looks at `getAnimations()`, and tw-animate-css was never wired anyway |

**Rows whose conclusion is unchanged**: matrix 2 (scrim click close), 3 (panel-inner click does not close), 10 (controlled semantics),
15 (three close paths), 13 (`#193` repo-specific), 16 (focus-ring canon), 17 (`#137` root marker),
18 (scrim color/radius/shadow); §5's `repo-specific must be kept` 7 items unchanged except item 6 (scrim keyboard reachability),
item 6 see §4.2(a).

## 7. e2e pinning surface

| spec | pinned contract | status after the generation switch |
|---|---|---|
| `overlay-focus.spec.ts:124-127` | `.overlay-mount:has(.sched-form-overlay)`'s `data-overlay-state='open'` | **still an old-stack surface** (`schedules-page` un-migrated) → valid today; **this surface must re-pin in sync when migrated** |
| `overlay-focus.spec.ts:104-109` | `elementFromPoint(100,400)` lands inside `.sched-form-overlay` (scrim covers the full viewport) | ditto |
| `overlay-focus.spec.ts:38-63` | `#389` focus return (after Esc `document.activeElement`'s focus-ring color) | migrated surfaces pass (`finalFocus`) |
| `dialog-viewport.spec.ts:20-38,120-130` | `#193`: `CAP = 500-48`, `.dlg-body` really overflows, button `toBeInViewport`, no displacement scrolling to bottom, 360-height viewport capping | migrated surfaces pass (className carries geometry) |
| `rerun-close-family.spec.ts:22-56` | `#168` hand-rolled `.overlay` three close paths + back returns to rerun | **still a fully hand-rolled surface** (`detail/overlays.tsx`) |
| `newtask-single-field.spec.ts:65,74` | `#394` + `#389`: entry `.new-task-spec`, return `.sidebar-new-task` | passes (entry by default, return by `finalFocus`) |
| `newtask-project-select.spec.ts:74-89` | layered Esc (inner closes first) + outside-press closes only the inner | passes (Base UI `isTopmost` + `onEscapeWhileNested`) |
| `hotkeys.spec.ts:121` | `#389` focus entry (`.new-task-spec` `toBeFocused`) | passes |
| `search-focus.spec.ts` | `#137` ⌘K input already focused + lit mutual-exclusion | passes (`viewportRoot`) |
| `team-create-agent` / `machine-add-dialog` / `provider-add-dialog` / `provider-oauth` / `secret-add-dialog` / `dialog-viewport` | the DialogShell family close law (X / Esc / backdrop, panel-inner click survives) | passes |
| `chip-assign` / `mention-picker-center` / `project-tasks-toolbar` / `board-filter` | the anchored popover family (FloatingShell) open/close and element anchoring | passes |
| `integration/test/m5-web-e2e.test.ts:268`, `m7-branch-dialog-e2e.test.ts:99-114`, `task-meta-e2e.test.ts:85` | `.dlg-accept-done` / `.dlg-machine-picker` / `.new-task-dialog` class anchors | passes (className passthrough) |

`#425` re-run record: full e2e 336/336, 33 related specs **assertions zero changes**.

## 8. Premortem (assuming a later migration slice has already failed, 3 most likely causes of death + guardrails)

1. **Cross-generation mixing eats the inner Esc.** Moving a surface that still hangs `useEscapeClose` (`window` keydown) into
   a migrated shell: Base UI `stopPropagation()`s at the document bubble phase (`useDismiss.mjs:106-109`),
   `window` never receives that keypress → the inner layer cannot close, showing `Esc closed the outer, the inner is still open`.
   Guardrail: the inner close always relays through the shell's `onEscapeWhileNested`; after every mixed migration **first run**
   `newtask-project-select.spec.ts:74-89`'s two layered assertions, then the full run.
2. **Inert animation class strings taken as effective.** Writing `data-closed:animate-out` on a new surface expecting an exit, actually zero CSS
   (§5) → the surface **unmounts immediately**, visually a hard cut, **with no error at all**.
   Guardrail: the exit recipe follows `ui/dialog.css:207-217`'s three-piece set (popup self-held `visibility` delayed transition +
   `[data-ending-style]` end state + child `anim-*` end state); after changing animation read `getAnimations()` for proof,
   not whether the class name is present.
3. **An un-migrated surface's exit assertion is missed during migration.** `overlay-focus.spec.ts:124-127` pins
   `schedules-page`'s `data-overlay-state`; once that surface migrates this attribute no longer exists, and the miss reds CI.
   The reverse is equally fatal: deleting `motion.css`'s `.overlay-mount[data-overlay-state="closed"]` rule first
   while the surface is un-migrated, the exit silently disappears.

## 9. Undecided / needs a separate decision

- **`FloatingShell`'s `ClickCatcher` keep-or-drop**: `floating-shell.tsx:14-17` states in writing the deliberate retention of the
  in-repo UX decision `outside-click only closes the popover, does not pass through to trigger the element below`, differing from Base UI's native outside-press semantics;
  `#425`'s lane record marks it the family's only pending item. Switching it is a UX change, not a mechanical migration.
- **Batch division of the un-migrated 12 files**: `#425`'s gap declaration's `chief-drawer` (follows B4),
  `search-panel` (`#453`), the mention-picker build-output centering bug (`#448`), and §4.4's list need aligning.
- **Disposition of the inert class strings** (§5.3 two options): delete the `tw-animate-css` dependency, or wire the import.
- **Making the entry target explicit**: whether to wire `initialFocus` per surface, turning §3.1's implicit contract into an explicit contract.
- **Backplate dual channel** (§4.2a): when not nested `onClose` is called twice, whether dedup is needed.

## 10. Fact sources

- Base UI source: the npm tarball `@base-ui/react@1.8.0` (3269 files) unpacked; all of this ticket's in-package
  `path:line` are relative to the package root; at runtime the `.mjs` prevails, for types the `.d.ts` prevails.
- Base UI official docs (the `.md` versions the registry item's `meta.links.api` points to):
  `https://base-ui.com/react/components/dialog.md`, `.../alert-dialog.md`,
  `.../popover.md`, `.../menu.md`
- shadcn `base-nova` registry JSON (4 items, all `type: registry:ui`, 1 file each,
  **none with a `dependencies` field**, none with `data-[starting-style]` / `data-[ending-style]`):
  `https://ui.shadcn.com/r/styles/base-nova/dialog.json` (imports `@base-ui/react/dialog`,
  registryDeps `[button]`), `.../alert-dialog.json` (`@base-ui/react/alert-dialog`),
  `.../popover.json` (`@base-ui/react/popover`), `.../dropdown-menu.json`
  (imports **`@base-ui/react/menu`**, the component name differing from the primitive name)
- Comparison baseline: `docs/research/418-dialog-contract-matrix.md` (branch `research/dialog-contract`, commit `2246789`)
- In-repo: `apps/web/src/components/ui/{dialog,alert-dialog,dialog-shell,alert-dialog-shell,floating-shell,popover,dropdown-menu}.tsx`,
  `apps/web/src/{overlay,overlays}/*`, `apps/web/src/ui/dialog.css`,
  `apps/web/src/styles/{motion.css,app.css,shadcn.css,tokens.css}`,
  `apps/web/e2e/*.spec.ts`, `apps/web/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- Version pins: `@base-ui/react` 1.8.0 (`apps/web/package.json:19`, `pnpm-lock.yaml:579`);
  `tailwindcss` 4.3.3 (`pnpm-workspace.yaml:27`); `tw-animate-css` 1.4.0 (`apps/web/package.json:30`)