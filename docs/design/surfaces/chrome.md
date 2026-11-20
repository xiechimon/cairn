# Chrome: buttons, panels, dialogs, menus, pickers

The global furniture every surface shares: buttons, the `SidePanel`, empty states, dialogs, menus, the ⌘K palette and the composer pickers. Rows, tabs, menus and empty states inside a side panel come from the tasks/sidebar family (`docs/design/surfaces/tasks.md`, `docs/design/surfaces/sidebar.md`).

## Buttons

- Primary button: shadcn Button default tier, `primary` background, 8px radius (`rounded-lg` = `--radius-control`), 32px tall. `DIALOG_PRIMARY_BUTTON` in dialogs, forms and empty states uses the same 8px (`rounded-md`). Ochre is never the primary-button background (V5); one screen has one primary action (V6).
- Secondary button: a text button that gains a light background on hover.
- Card actions: `accent` text links + icon, with the `accent-hover` background on hover.

## SidePanel

`components/side-panel.tsx` (`SidePanel` / `SidePanelHead` / `SidePanelTitle`): the one right-hand panel shell (task panel, threads inbox). 420px on `background`, with a 1px `--border` left divider and no desktop shadow; below 1100px it floats over the `dialog-backdrop` scrim with `floating-shadow`, full width below 640px. The head is 48px with 16px side padding and no rule under it, a `text-heading` (15px) regular title and the 28px ghost close button with an 18px glyph last; head buttons sit 8px apart. Measured from the reference recording. The Tasks panel tabs use `SegmentedTabs quiet`; the results and computer panels use the tracked `SegmentedTabs` (28px track, 24px options, regular labels in `ink-1`, the selected option raised on `seg-active` with a hairline). Section labels in the results and computer panels are `text-ui` regular in `ink-1`, 10px inside the card edge. Pages never write their own `aside` or panel header. For the task thread panel's own head and docking see `docs/design/surfaces/tasks.md`.

## Selector and ⌘K

- The selected row in pickers that are not menus: white card (`card`) + `line` hairline ring + at most one extremely light shadow (0 1px 2px). No hover tint, no accent.
- ⌘K is a menu-style palette (Linear): 640px, rows 32px with the `menu-hover` fill and 8px corners. On a task page the task rides along as a chip above the input and its commands come first under "This task"; typing filters commands and results together; Backspace on an empty input drops the chip. A footer row shows the keys (move, drop context, close, and open only while the arrow keys pick a row, since no row is lit at rest and Enter at rest opens nothing); on touch it shows only `语法`.
- Folder picker (`DirBrowser`, Amp's project picker): a search / paste-a-path input, then Recent (picked folders and project folders) and the git repositories in the last browsed folder; each row is name, grey path on the right and a `git` tag. "Browse folders…" at the bottom opens the old breadcrumb tree.

## Slash and @ lists (Claude Code)

- The slash list is 240px of 28px rows: the command name in sans `text-ui`, no `/` prefix and no monospace, the typed part in bold; no group headings, a thin rule between commands and skills. The description shows only as a dark bubble beside the highlighted row.
- The @ list is one mixed list (agents, tasks, projects, files) with no headings or rules: a 16px avatar or outlined kind icon, the name, then its secondary text inline in `ink-3`, truncated.

## Empty state

Piece: `EmptyState` in `src/components/empty-state.tsx` (the base is the registry `Empty`).

- **Icon**: a line icon, 32px, stroke 1.75, `icon` (`text-icon`), no background tile.
- **Title**: `h2`, display `text-heading` 500 `ink`; the description below is `text-ui` `ink-2`.
- **Description**: `text-ui` `ink-2`, at most 320px wide (about 44ch), centered, `text-balance`.
- **Primary action** (optional): shadcn Button default tier, `primary` background, 32px, 8px corner (`DIALOG_PRIMARY_BUTTON`). An empty state has at most one primary action.
- **Hint line** (optional): one `text-meta` `ink-3` line below the primary action, optionally preceded by a 12px icon (`ink-4`), explaining read-only or permission reasons.
- **Used on**: list pages with no data (API keys, schedules, skills, MCP, keys…). The copy is translated by the caller before being passed in.
- Do: a bare icon + title + one sentence. Do not: an icon tile with a colored background (neither orange nor beige), a `size="sm"` small button, two side-by-side primary buttons, or a "View docs" external link.

## Dialogs and menus

Pieces: `src/components/ui/dialog-shell.tsx` (`DialogShell` + the exported `DIALOG_*` pieces, `DialogFootRow`, `dialogWidth`), `alert-dialog-shell.tsx` (confirm surfaces), `dropdown-menu.tsx` / `popover.tsx` (menus and floating surfaces). `dialog.tsx` / `alert-dialog.tsx` / `select.tsx` are pristine registry pieces; their skin lives in the `[data-slot=…]` rules and tokens of `styles/app.css`.

- **Backdrop**: one layer of black dim `--dialog-backdrop` (40% light, 50% dark, claude.ai), no blur. All dialogs, confirm surfaces, and ⌘K share this layer; there is no dark curtain.
- **Surface**: `--dialog-surface` (the sidebar layer in dark, white in light), 12px radius (`--edge-radius`), `--dialog-shadow` (= `--e3`: two soft shadows and a 5% ring).
- **Three widths** (`size`, `--dialog-w-*`, clamped with `min(100% - 2rem, …)` on narrow screens):
  - S 400: keys, API keys, delete and other confirmations, short forms.
  - M 480: skills, most new-entity forms (agent, schedule, charter, review, request changes).
  - L 640: multi-step flows and long lists (add machine, provider selector, GitHub issue, raw error, attachment preview, new task).
- **Head**: 15px semibold title (`text-heading`, the reference's dialog titles measure semibold) + an optional 13px `ink-3` subtitle line (`subtitle`, `text-meta`); a 28px ghost close button in the top-right corner. The close button is last in the DOM, and initial focus lands on the first field.
- **Route dialogs** (`overlay/route-dialog.tsx`): New project and Project settings float over the page you came from, as Settings does, and keep their URLs (`/app/project/new`, `/app/project/:id/settings`); closing returns to that page. New project is an M form; Project settings is settings size (`--settings-w` by `--settings-h`), and below 640px a settings-size route dialog fills the screen like Settings.
- **Body**: the single scrolling box (`min-h-0`), with 16px left/right padding (head, body and foot alike; the reference settings modal measures 16px from the edge to the title, the nav and the content) that also serves as room for the focus ring. The panel is capped at `100vh - 64px`; in short viewports the body scrolls and the foot stays on screen. With a foot, the body keeps 4px of bottom padding so the last field and the foot's buttons sit 16px apart (the reference's code and rename dialogs).
- **Foot (split)**: a 13px `ink-3` hint or status on the left (`text-meta`) (`hint`: doc links, shortcuts, waiting states, page numbers), the action group on the right. The primary action is the shadcn Button default (`primary` background, 32px, 8px corner, `DIALOG_PRIMARY_BUTTON`), the secondary action (`取消`) is a grey filled pill beside it (`DIALOG_TEXT_BUTTON`: `secondary` fill, `ink` label at weight 400, the same 32px height and 8px corner, the fill 5% darker on hover; the family of the toast's action pill and the reference's `Cancel`), and danger confirmations switch to `destructive`. A disabled primary is paler than the pill in fill and label (`secondary` at 50%, `--text-dim`; see `docs/design/surfaces/settings.md`, Forms). With no hint the actions still align right. No background band, no divider line.
- **Menus** (one menu surface — `DropdownMenu` / `Popover` / the Select popup are the same surface, #1767): `popover` background, 14px radius (`--radius-popover`), 4px padding (`--menu-pad`), `--shadow-popover` (= `--e2`: soft shadow + inset ring). Rows are 32px tall with an 8px radius (`--radius-menu-item`, claude.ai's 14/8 pair), 14px text, 18px icons in the row's `ink` (reference recording), hover `menu-hover`; every row of an action menu ends in one key hint, right-aligned in `text-caption` `ink-3` (see Menu keys below); dividers 1px, inset 6px left and right; group labels `text-caption` 500 `ink-3`. Danger rows use `destructive` for text and icon, hover `danger-soft`. The sidebar row menus are the one denser variant (`docs/design/surfaces/sidebar.md`, row menu). Segmented controls inside menus use `SegmentedRadio` / `SegmentedTabs`; do not hand-roll them.
- **Menu keys** (`components/menu-keys.tsx`, outside the pinned `components/ui`): every row of an action menu shows one letter on the right (`KeyedMenuItem`, `KeyedMenuRadioItem`, `KeyedMenuCheckboxItem`, `KeyedMenuSubTrigger` take a `shortcut`), and pressing it while the menu is open runs that row. One handler on the popup (`KeyedMenuContent` / `KeyedMenuSubContent`) does the matching, so no menu carries its own key code. The letter comes from the label, and a clash goes to the next letter that still reads well (Complete `C`, Request changes `R`, Stop `S`, Copy link `L`, Archive `A`, Close `X` because `C` is taken, Delete `D`; Mark as unread `U`). A row that opens a confirmation ends in an ellipsis (`Delete…`, passed as `confirms`). The hint is one quiet style everywhere: `text-caption`, `ink-3`, no box, right-aligned, tabular figures. Letters are not typeahead: while a keyed menu is open a letter that no row owns does nothing (it neither moves focus nor reaches the global keys), arrows, Enter, Escape and Tab behave as before, chords with Cmd, Ctrl or Alt and IME composition are left alone, and a text field inside the menu types normally. Menus of user data (project and model pickers, thread switchers) have no letters; version rows use digits. A picker of user data with more than 10 options filters as you type instead (C19, `components/filter-picker.tsx`). Never show a hint that does nothing. Menus are built from these keyed parts only; `test/menu-keys-source.test.ts` fails when a raw `DropdownMenuItem` or `DropdownMenuContent` appears outside `components/ui`, so a new action menu cannot ship without its letters.
- **Global keys on controls** (`KeyHint`, `components/key-hint.tsx`): a key that works anywhere (`C` new task, `⌘K` search, `⌘J` Coordinator, `N` new thread) shows on the control it triggers, always and in the menu-key style, not only on hover (sidebar rows, the Tasks panel `+`, the Save and start button). Icon-only controls name the key in their tooltip instead. The boxed `Kbd` stays for sentences and tooltips (`Press ⌘K to search`).
- Do: one width tier per dialog, hints left and actions right, equal-height menu rows. Do not: a dark or blurred backdrop, full-width submit bars, a gray-background foot band, outline or bare-text secondary buttons, or small gray 12px menus.
- `e2e/color-freeze.spec.ts` pins `dialog-backdrop` / `menu-hover`.
