---
name: Cairn
direction: Cairn (stone trail) · dense · project-first
reference: prototype A, the acceptance reference of the B-UI batch
colors:
  # Light (.light): cool limestone paper, lichen ink, three status hues; dark values live in colors-dark, rules in the "Colors" and "Dark" sections
  canvas: '#e6e7e1'        # app background: the stone the sidebar sits on
  sheet: '#f6f6f2'         # main surface (--background)
  card: '#fdfdfb'          # cards, rows, composer
  popover: '#fdfdfb'       # menus share the card color in light
  hover: '#dcded7'         # sidebar row hover (--sidebar-hover)
  line: '#dcdfd7'          # hairline ring and dividers (--border)
  rule: '#dcdfd7'
  divider: '#dcdfd7'
  ink: '#1d231f'           # headings and body text
  ink-2: '#4b534d'         # secondary text (nav, buttons, descriptions)
  ink-3: '#5f665f'         # meta information (project, time, counts)
  ink-4: '#a8aea6'         # decorative icons only, never text
  icon: '#5f665f'          # icons with a text label
  accent: '#9a6500'        # ochre (--card-button): waiting on you, action links, count badges
  primary: '#233127'       # primary button: deep lichen ink
  on-primary: '#f4f6f1'
  on-accent: '#ffffff'     # text on count badges and project tiles
  accent-hover: '#f7ecd2'  # action link hover background
  menu-hover: '#eff1eb'    # menu row hover background
  backdrop: 'rgb(29 35 31 / 0.28)'  # dialog backdrop (ink dim, no blur)
  running: '#5f8f4f'       # working: running icon, online dot
  running-text: '#3f6c35'  # working text
  running-bar: '#55833f'
  running-track: '#e1e3dc'
  project-tiles: ['#3f6c35', '#9a6b3a', '#5379a0', '#7a5b8e', '#3d7c7a', '#8a5560']
colors-dark:
  # Dark (:root default): the same ladder in deep stone, brighter with elevation
  canvas: '#141715'
  sheet: '#1b1f1c'
  card: '#222723'
  popover: '#262b27'       # menus: one step brighter than the card
  hover: 'rgb(230 232 226 / 0.05)'
  line: '#353b36'
  rule: '#353b36'
  divider: '#353b36'
  ink: '#e6e8e2'
  ink-2: '#b4bab3'
  ink-3: '#959c96'
  ink-4: '#5d655f'         # decorative icons only, never text
  icon: '#959c96'
  accent: '#ebb550'        # ochre brightened; text on it is dark ochre, not white
  primary: '#e6e8e2'       # primary button is limestone in dark
  on-primary: '#161a17'
  on-accent: '#1a1404'
  accent-hover: '#33290f'
  menu-hover: '#2e3430'
  backdrop: 'rgba(0, 0, 0, 0.5)'
  running: '#82b46f'
  running-text: '#9cc78b'
  running-bar: '#6fa35c'
  running-track: '#2e3430'
  project-tiles: ['#6f9c5f', '#b98a57', '#6f93bb', '#9a7cad', '#5fa3a0', '#b77f8a']
typography:
  greeting:     { fontFamily: serif, fontSize: 26px, fontWeight: '600' }
  page-title:   { fontFamily: serif, fontSize: 20px, fontWeight: '600' }
  heading:      { fontFamily: display, fontSize: 17px, fontWeight: '650' }
  brand:        { fontFamily: display, fontSize: 20px, fontWeight: '650' }
  card-title:   { fontFamily: sans, fontSize: 14px, fontWeight: '600', lineHeight: '1.5' }
  ui:           { fontFamily: sans, fontSize: 14px, fontWeight: '450' }
  meta:         { fontFamily: sans, fontSize: 12.5px, fontWeight: '450' }
  caption:      { fontFamily: sans, fontSize: 12px, fontWeight: '500' }
  code:         { fontFamily: mono, fontSize: 12px, fontWeight: '400' }
fonts:
  serif: var(--font-source-serif) # Source Serif 4 → Songti SC: greeting and page titles
  display: var(--font-display)   # Bricolage Grotesque → sans
  sans: var(--font-sans)         # Instrument Sans → PingFang SC
  mono: var(--font-mono)         # JetBrains Mono
rounded:
  field: 8px         # rounded-md: inputs, selects, segmented tracks, dialog and form primary buttons
  control: 8px       # --radius-control = rounded-lg: default Button, icon buttons, rows
  menu-item: 12px    # --radius-menu-item = menu radius minus the 6px menu padding
  card: 14px         # --radius-card = rounded-xl: one corner for every card-like surface
  sheet: 18px        # --edge-radius: dialogs, ⌘K
  menu: 18px         # --radius-popover: menus, floating surfaces, dropdowns
  bubble: 14px       # --radius-bubble: user chat bubble
  composer: 14px     # --radius-composer
  window: 18px       # --radius-window: chief window
  full: 9999px
spacing:
  grid: 4px
  card-padding: 12px 14px
  column-gap: 16px
  board-padding: 18px 24px
  header-height: 56px
  sidebar-width: 248px
  nav-row-height: 32px
  dialog-s: 400px    # --dialog-w-s
  dialog-m: 480px    # --dialog-w-m
  dialog-l: 640px    # --dialog-w-l
  menu-row-height: 32px
---

Live gallery: run `pnpm --filter @cairn/web dev` and open `/design.html`. It renders the shipped components and page patterns on the real tokens, and its Doc check section compares this frontmatter with the rendered values in both themes.

## Direction

Cairn is an open-source, self-hostable agent team. The user is a keyboard-first engineer who talks to a project's Coordinator, then checks back on the threads it ran; the core question is "what is waiting for me".

Direction A, **Cairn**: a cairn is a pile of stones that marks a trail for the next walker. The paper is cool limestone in light and deep stone in dark; hierarchy comes from three surface steps (canvas → sheet → card) plus hairline rings, not heavy shadows. Three hues carry meaning and nothing else does: ochre `accent` means "waiting on you" and is actionable, lichen green `running` means "working", slate blue means "ready for review". Everything else is the ink ladder. The stone language lives inside the UI: status marks are pebbles, the Threads inbox reads as a trail with waypoints. The brand stays the spiral mark (`public/logo-mark.svg`), which is also the Coordinator's avatar and spins while it works.

## Colors

- **Three stone layers**: `canvas` (app background; the sidebar sits directly on it) → `sheet` (main surface) → `card` (near-white cards, rows and the composer, `#fdfdfb` in light).
- **One theme file**: every token lives in `src/styles/shadcn.css` (the file `components.json` points the shadcn CLI at). Its first `:root` block holds theme-independent tokens (motion, z-index, type, radii, sizes, formulas over color slots) followed by the dark colors; `.light` overrides the colors only. A palette change touches one file.
- **Borders are always 1 CSS pixel**: the main panel, task cards, the active nav item, and the new-task button stay 1px on high-density screens too (they do not follow `--hairline` down to 0.5px); borders must be visible.
- **Three-tier shadow ladder** (#1428): `--e1` cards and rows, `--e2` menus and floating surfaces, `--e3` dialogs and floating windows. Each tier carries its own 1px ring at the end (`--e1` uses `line`; `--e2`/`--e3` use `--elevated-ring`, which is `line` in light and `--ring-inset-highlight` in dark, where `line` is invisible on the surface base). Light shadows are tinted ink (`rgb(29 35 31 / a)`) rather than neutral black so they sit in the paper, and no extra border is drawn on the surface; surfaces that draw their own `--edge-ring` (the notification strip, the chief window, the FAB) take the pool of the same tier: `--cds-shadow-sm` / `-md` / `-lg` — one ring per edge. Old slot names like `--panel-shadow` / `--shadow-popover` / `--dialog-shadow` are aliases; the hover / focus slots are states, not tiers.
- **Four ink steps**: `ink` headings and body text; `ink-2` nav, buttons, descriptions; `ink-3` meta information; `ink-4` decorative icons only. The lightest text ever uses is `ink-3`.
- **Contrast (light, measured, WCAG 2.x)**: on the card, `ink` is 15.71, `ink-2` 7.80, `ink-3` 5.80, `accent` 4.87, `running-text` 6.05, `destructive` 6.45; `icon` is 5.80, the same step as `ink-3`, so labelled icons read as solid as their text; `ink-3` on canvas is 4.75 and on `--secondary` (`#eceee8`) 5.06, `ink-2` there 6.79. White text on the `accent` background is 4.96; `on-primary` on `primary` is 12.53. White text on the six light project tiles measures 4.55–6.16. The running bar on its track is 3.45. Action links swap to `spot-text-on-tint` on the `accent-hover` background (6.84), because `accent` on it drops to 4.22. `ink-4` is decorative only.
- **Focus ring**: `--focus-ring` is lichen `#3f6c35` in light (6.05 on the card) and `#9cc78b` in dark, so keyboard focus never reads as "waiting on you". Buttons, checkboxes, switches and badges draw it as a 2px outline 2px outside the box. Text fields (`Input`, `Textarea`, `SelectTrigger`, the `InputGroup` shell) turn their own border `--focus-ring` and add a 3px `--focus-halo` (the ring at 22%) instead, so the field reads as one shape, not a box inside a box. An invalid field (`aria-invalid`) shows one `destructive` 1px border at rest and, when focused, that border plus a 3px `--danger-halo` (destructive at 20%); it never stacks the green focus ring on top of the red border.
- **Brand marks**: the spiral launcher disc uses `--fab-surface` `#2f5a2a` with the `--fab-mark` `#f4f6f1` spiral in both themes, the nearest stone-green to the Cairn app icon.
- **Status chips use five distinct hues**: idle neutral, plan slate blue, confirm ochre, done lichen green, failed rust (`--chip-*-bg` / `--chip-*-fg`, every pair 5.5+ in light and 7.0+ in dark). Plan is deliberately not ochre: only "waiting on you" may look like the accent.
- **Accent discipline**: `accent` is used only for: needs-your-attention states and counts, action links on cards, icons of the active nav item, and count-badge backgrounds. It is never decorative and never a large-area background.
- **Status is never color alone**: every status is a triple of "icon + color + text" (failed ⊗ failed / awaiting confirmation ☰ awaiting confirmation / awaiting review ⑂ awaiting review); color-blind users can tell them apart by icon and text.
- **The primary button is `primary`**: the shadcn Button default tier. In light it is deep lichen ink `#233127` with `#f4f6f1` text; in dark it is limestone `#e6e8e2` with deep stone text. Ochre is never the primary-button background, so "do this" and "waiting on you" never look alike.
- Colors live only in `src/styles/shadcn.css`; components write token names, never hex values (`scripts/ui-drift-gate.mjs` G2 already pins this).

## Typography

- **Two title faces**: Source Serif 4 (`font-serif`, 600, -0.01em) for the Coordinator greeting and page titles (the board top bar, page shells, the task detail header, settings headers), so the top of every page has one quiet serif voice. Bricolage Grotesque (`font-heading` with `font-title`, 650) for the brand name, section and column headings, pane and dialog titles. Chinese falls back to Songti SC under the serif and PingFang SC under the sans.
- **Everything else is Instrument Sans** (`--font-sans`): thread titles, rows, navigation, buttons, meta. Chinese falls back to PingFang SC. Code, times, ids and counters use JetBrains Mono (`--font-mono`) with tabular numbers.
- Fonts are self-hosted latin subsets in `public/fonts` (SIL OFL 1.1, licenses next to the files), loaded with `font-display: swap` and preloaded in `index.html` and `design.html`; the metric-matched fallbacks keep the swap from shifting layout.
- **Six font sizes, no seventh allowed**: 26 Coordinator greeting / 20 page title and brand / 17 column and section headings / 14 card titles and UI text / 12.5 meta / 12 badges and group labels. In code, use the corresponding Tailwind theme keys `text-greeting` / `text-page` / `text-heading` / `text-card-title` and `text-ui` / `text-meta` / `text-caption` (heading font `font-heading`), never arbitrary values like `text-[13px]`; `scripts/ui-debt-gate.mjs` D5 only allows the total count of arbitrary values to decrease.
- **Four font weights**: 450 body text (`font-normal` maps to 450, because Instrument Sans at 400 reads faint at 14px), 500 sidebar rows and captions, 600 card and row titles, the active nav row and count badges, 650 display titles (`font-title`, always paired with `font-heading`). 700 is not used.
- The title of a completed task drops to 400 + `ink-3`, meaning "no longer needs to be read".

## Layout and spacing

- 4px grid. Common values: 4 / 8 / 12 / 16 / 24. Card padding 12×14, card gap 8, column gap 16, board padding 18×24.
- Top bar 56px: display page title on the left + "⚠ N items need your attention"; text buttons on the right (filter, schedules) + the ink primary button "New task". All top-bar elements are `nowrap` and do not wrap in narrow windows.
- Sidebar 248px, sitting on `canvas`; the main surface fills the rest edge to edge (see "Current shell and board surface").
- One screen has only one primary action (the primary button); the rest are text buttons or `accent` links inside cards.

## Icons

- Icon library lucide (configured in `components.json`), stroke 1.75.
- Sizes: meta 12, card actions and status 13, top-bar buttons 14, column headings 15, sidebar nav 16.
- Colors: meta icons and collapse arrows use `ink-4` (`text-content-dim`); sidebar nav icons take their row's `ink`, 18px at stroke 1.75; other icons with a text label (column headings) use `icon` (`text-icon`); pure-icon buttons without a text label (search, collapse sidebar, collapsed sidebar icons) use `ink-3`, preserving the 3:1 non-text contrast; icons of the active nav item and anything "needs you" use `accent`; running-related icons use `running`.
- Shapes: workbench = three columns (Columns3); collapse/expand sidebar = panel (PanelLeft, no arrow).
- Column heading icons are fixed: `待开始` = dashed circle, `执行中` = pulse line, `待处理` = exclamation circle, `已完成` = check circle.

## Components

### Sidebar (Grouped)
From top to bottom:
1. **Workspace row**: spiral mark (`public/logo-mark.svg` as a mask, 22px, taking the row ink `ink`) + display brand name at 20px + dropdown arrow; two icon buttons on the right: search (⌘K) and collapse sidebar.
2. **New-task button**: see "Current shell and board surface" below. It is an action, not a nav item.
3. **Work nav**: workbench, needs my attention (`accent` count badge on the right), schedules. Active item = `accent` icon.
4. **Projects**: group label "Projects" + plus on the right; each project is one row = colored first-letter tile (colors taken in order from `project-tiles`) + name + unfinished count.
5. **Footer**: one "Resources" row (skills / MCP / keys / machines / providers collapsed inside, expanding into an indented sub-list on click); user row = avatar + name + second line "● 2 machines online · N running".

### Board columns
- Column header: status icon + sans column name + `ink-3` count; hovering the `待开始` column shows a plus on the right (new tasks land only in that column; other columns get no plus). A `rule` line sits below.
- An empty column says what is missing in one plain sentence (`还没有待开始的任务`, `没有在跑的任务`, `没有等你处理的事`, `最近 7 天还没有完成的任务`), never a bare `暂无`. The empty `待开始` column instead shows one dashed ghost card, `写下想做的事` with the `C` key cap, which opens the new-task dialog.
- While the first board read is in flight, each column shows two skeleton cards (registry `Skeleton`) in the card shape, so the layout does not jump when data lands.

### Task card
- `card` surface, 14px corner (`--radius-card`), a `line` 1px hairline ring plus one very light ink shadow (`0 1px 2px`, 5% in light; together they are `--e1`), so the edge is crisp, never soft. On hover the ring deepens and the shadow rises to `0 6px 16px -2px` at 9% (150ms ease-out). No second large blur shadow.
- In-flight orchestration (start was pressed, the chief has not dispatched yet): a todo card swaps `开始` for a footer `编排中 · reason` (waiting for X to come online / missing capability / queued) plus `查看会话` on the right; a failed card swaps `重试` for an inert `编排中`. Nothing is layered over the meta line.
- A failed orchestration shows a short plain summary (`orchestrationErrorSummary`: connection dropped, timed out, out of quota, context too long, bad key, provider unavailable); the raw provider error stays in the `title` tooltip and never wraps character by character on the card.
- Structure: title (at most two lines), then one meta line (project, #number, tag, time; never wraps; when space runs out the tag truncates first and the project keeps at least five characters), then a footer by status. The tag icon uses the user's tag color; the tag name uses the meta ink. A standalone tag (`TagChip`) is a neutral outline pill (`card` background, `line` ring, `ink` text) with an 8px dot in the tag color; the tag color never fills the pill.
- The right-side meta icons (plan, changes, chief-created, branch) stay hidden until the card is hovered or focused, and are always visible on touch screens (`pointer-coarse`).
- Footer:
  - Three pending states: dashed divider + status icon and name (ochre) + reason (truncated) + an ochre action link on the right (retry / confirm plan / review).
  - Running: robot icon (slow breathing) + `agent · current step` + `3/7` on the right, with a 3px progress bar below. Queued cards (started, waiting for a machine) live in this column too: a still hourglass + secondary ink `agent · 排队中`, switching to `等机器 / 等额度` when suspended; no breathing, which is reserved for cards that are really running.
  - Todo: only cards that have not started. No footer; `开始` floats at the right of the meta line on hover and takes no height.
  - Done: no footer, title demoted.
- No solid buttons on cards.

### Buttons
- Primary button: shadcn Button default tier, `primary` background, 8px radius (`rounded-lg` = `--radius-control`), 32px tall. `DIALOG_PRIMARY_BUTTON` in dialogs, forms and empty states uses the same 8px (`rounded-md`).
- Secondary button: a text button that gains a light background on hover.
- Card actions: `accent` text links + icon, with the `accent-hover` background on hover.

### Selector and ⌘K
- The selected row (keyboard cursor or hovered row): white card (`card`) + `line` hairline ring + at most one extremely light shadow (0 1px 2px). No hover tint, no accent.

### Settings lists (account page, agent overview)
See "Page patterns · Settings list" below.

### Conversation
- User turns sit on the right with no avatar: a `--secondary` bubble, at most `min(80%, 56ch)` wide, 32px tall for one line, with a tighter bottom-right corner. Their action row aligns right. Agent and chief turns keep the avatar on the left.
- Copy icons under a message stay hidden until its row is hovered or focused (`.chat-copy` in `app.css`); touch screens always show them.
- The plan preview fades out at the bottom with a mask instead of a hard cut.
- The composer is a white card (`--card`) with a 1px `--input` ring that turns lichen with a soft halo on focus (`--shadow-composer*`); it is the one white surface in the conversation because it is where you act. The idle send button has no fill; only the stop button gets the `seg-active` square.

### Trace
- Agent activity (tool calls, thinking, waiting) renders as Trace lines (`components/ui/trace.tsx`), never as hand-written rows. One line per action: optional icon, title, then a tabular-number description such as the duration. Every line is sans `text-meta` (12.5px) in `ink-2`; a command or tool name goes in an inline `font-mono text-caption` code span, never a mono line. Errors keep the line in `ink-2` and add a 500 `destructive` "Failed" label (and a `destructive` icon); the whole line never turns red. Pending lines use `ink-3`, not opacity. The live spinner is `running` green, because it means working, not waiting on you. The chief turn-tool panel uses a 1px `border` rule, the same weight as collapsible detail.
- Status lives on the line: `running` sweeps the title with the `shimmer` utility (`app.css`, still under reduced motion), `error` turns the line `--destructive` and keeps a visible "failed" word, `pending` dims it to 60%.
- Detail such as full thinking or tool output folds under its line with `TraceCollapsible`; the chevron sits after the title and the content hangs on a hairline left rule.
- The chief turn panel is a Trace on `--secondary` with mono `text-caption` lines in `--text-tertiary`; agent rows in the task transcript use 12px `--text-dim` lines.

## Page patterns

Pages like settings, resources, team, and project share the pieces below. A new page composes these pieces first and does not build its own cards, empty states, or forms inside the page. All pieces live in `src/components/`; all values go through tokens and the six font sizes.

### Card radius: one corner
- **Token**: `--radius-card` = 14px (`rounded.card`), the class `rounded-(--radius-card)`, or `CARD_RADIUS_CLS` exported by `settings-list.tsx`.
- **Used on**: every card-like surface — task cards, cards being dragged, settings cards, team / agent cards, grouped resource-row cards, one-off notice cards.
- **Not in this list**: dialogs and the ⌘K panel are the sheet tier at 18px (`--edge-radius`); menus and floating surfaces use `--radius-popover` (18px, see "Dialogs and menus" below); buttons, icon buttons, rows, inputs and selects are 8px (`--radius-control`, `rounded-md`).
- The registry `Card` ships with `rounded-xl`, which equals `--radius-card` (14px).
- Do: one corner for all cards on a page. Do not: write 10px / 18px cards into a page, or mix two card corners on one page.

### Empty state
Piece: `EmptyState` in `src/components/empty-state.tsx` (the base is the registry `Empty`).
- **Icon**: a line icon, 32px, stroke 1.5, `icon` (`text-icon`), no background tile.
- **Title**: `h2`, display `text-heading` 650 `ink`; the description below is `text-ui` `ink-2`.
- **Description**: `text-ui` `ink-2`, at most 320px wide (about 44ch), centered, `text-balance`.
- **Primary action** (optional): shadcn Button default tier, `primary` background, 32px, 8px corner (`DIALOG_PRIMARY_BUTTON`). An empty state has at most one primary action.
- **Hint line** (optional): one `text-meta` `ink-3` line below the primary action, optionally preceded by a 12px icon (`ink-4`), explaining read-only or permission reasons.
- **Used on**: list pages with no data (API keys, schedules, skills, MCP, keys…). The copy is translated by the caller before being passed in.
- Do: a bare icon + title + one sentence. Do not: an icon tile with a colored background (neither orange nor beige), a `size="sm"` small button, two side-by-side primary buttons, or a "View docs" external link.

### Settings list
Pieces: `src/components/settings-list.tsx`. The account page's "edit name" header is in `src/components/profile-card.tsx` (`ProfileHeader`, composing `SettingsHeader`).
- **Header above the card** (`SettingsHeader`): 56px white circular avatar (`line` 1px ring) + display title (`text-page` 500) + a `text-meta` `ink-3` description below; one optional action on the right (usually a text button). The name is not repeated as a row inside the card. For inline renaming, `editor` replaces the title, description, and action.
- **One card** (`SettingsCard`): white background, `line` 1px outer ring, `--radius-card`; rows carry no background color (no two-tone cards).
- **Row** (`SettingsRow`): minimum height 52px, 16px left and right; a `text-ui` `ink` label on the left (optionally with one `text-meta` `ink-3` description line), controls on the right. Rows with two-line content grow naturally. Custom rows that do not go through `SettingsRow` use `SETTINGS_ROW_CLS`.
- **Dividers are drawn only between rendered rows**: `divide-y` on the card, rows rendered conditionally, never hidden with CSS. A hidden row is still a sibling node and would draw a second border at the top of the card.
- **Controls are framed, one kind each**: dropdown = white background + `line` 1px ring + 8px radius + 32px tall (`SETTINGS_SELECT_TRIGGER_CLS`, the same string as the form's `FORM_CONTROL_CLS`); single-choice segmented = `SettingsSegmented` (i.e. `SegmentedRadio`, see "Segmented control" below); switch = `ToggleSwitch` (`components/toggle-switch.tsx`, never the bare registry `Switch`): a 36×20 track, a 16px white thumb inset 2px with a soft shadow, `--switch-on` green when on (`#55833f` light, `#6fa35c` dark) and `--switch-off` stone when off.
- **Danger zone** (`SettingsDangerZone`): a separate card at the very end of the page, one row: label + description on the left, a Button with `variant="destructive"` on the right, 32px with the standard 8px button corner. Clicking opens a confirm layer first; it never deletes directly.
- Do: header + one card + equal-height rows. Do not: a large avatar occupying a row, rows with background tints, a rounded-pill delete button, or danger actions mixed into ordinary settings cards.

### Forms
Piece: `src/components/form-layout.tsx` (the base is the registry `Field` family).
- **Stack** (`FormStack`): fields stacked vertically, 16px between fields, at most 520px wide, left-aligned.
- **Field** (`FormField`): label on top (`text-ui` 500 `ink`, `htmlFor` pointing at the control), the control, and an optional help line (`text-meta` `ink-3`) below.
- **Controls**: Input / SelectTrigger with `FORM_CONTROL_CLS`: 32px tall, white background, `line` 1px ring, 8px radius, `text-ui`.
- **Action row** (`FormActions`): the last row of the form, right-aligned; an optional text button (such as `取消`) on the left, the shadcn Button default primary on the right. When the form cannot submit, the button's own `disabled` state paints it `secondary` with secondary ink at full opacity; every default (primary) Button disables this way, not only `DIALOG_PRIMARY_BUTTON`, so there is one disabled-primary look. Other tiers fade to half strength. No separate gray bar.
- Do: a narrow column, labels on top, the primary button on the right. Do not: inputs spanning the whole column, full-width gray submit bars, or two-column forms with labels beside inputs.

### Segmented control
Piece: `src/components/segmented.tsx`. One appearance, two semantics:
- **`SegmentedTabs`**: switches views — each option controls a panel or a route (agent overview / memory / permissions, project tasks | files, files | history, list | grid, team grid | org chart, provider runtime, branch dialog, chief settings). The base is the registry `Tabs`, keeping `tablist` / `tab` semantics.
- **`SegmentedRadio`**: picks a value in a form or settings (appearance in the user menu, schedule frequency). `radiogroup` / `radio` semantics; arrow keys move and select, roving tabindex. Use it for "selecting a value that will be persisted"; use tabs for "which block to look at".
- **If it does not fit, switch to a dropdown**: when the option labels at 12px padding do not fit the column width, do not shrink the text and do not truncate — use the form Select instead (`SelectTrigger` + `FORM_CONTROL_CLS`). Example: the API protocol in the new-provider dialog (the three protocol names need about 460px; the dialog column is 416px wide).
- **Appearance**: track 32px tall, 2px inset, 8px radius, background `canvas` — one stone token; options 28px tall, 6px radius, 12px left/right padding for text options, and pure-icon options are 28px squares (must carry an `ariaLabel`). Unselected text is `ink-2`, turning to `ink` on hover, with no background tint; the selected option = white background (`card`) + `line` 1px ring + one extremely light shadow, text 500 `ink`. The accent is not used. Disabled items use the primitive's own translucency.
- **Focus**: mouse clicks show no ring. Keyboard `:focus-visible` is a 2px `--focus-ring` ring, **inset** inside the option box (`outline-offset: -2px`, the `[data-segmented="option"]` rule in `styles/app.css`): options are only 2px apart, and an outer ring would press onto the neighbor.
- **Sliding**: `slide` makes the white tab slide between options on a 150ms underlying pill (only chief settings uses it, #644).
- Do: assemble every segmented control from these two pieces; e2e handles attach via `className` (track) and `optionHandle` (option). Do not: hand-write `role="radiogroup"` / `role="tab"`, or restyle `TabsList` / `TabsTrigger` directly in a page — `scripts/ui-drift-gate.mjs` G7 will block it.

### Dialogs and menus
Pieces: `src/components/ui/dialog-shell.tsx` (`DialogShell` + the exported `DIALOG_*` pieces, `DialogFootRow`, `dialogWidth`), `alert-dialog-shell.tsx` (confirm surfaces), `dropdown-menu.tsx` / `popover.tsx` (menus and floating surfaces). `dialog.tsx` / `alert-dialog.tsx` / `select.tsx` are pristine registry pieces; their skin lives in the `[data-slot=…]` rules and tokens of `styles/app.css`.
- **Backdrop**: one layer of light-ink dim `--dialog-backdrop` (light `rgb(29 35 31 / 0.28)`), no blur. All dialogs, confirm surfaces, and ⌘K share this layer; there is no dark curtain.
- **Surface**: `sheet` background (`--dialog-surface`), 18px radius (`--edge-radius`), `--dialog-shadow` (= `--e3`: two soft shadows + a 1px `line` ring).
- **Three widths** (`size`, `--dialog-w-*`, clamped with `min(100% - 2rem, …)` on narrow screens):
  - S 400: keys, API keys, delete and other confirmations, short forms.
  - M 480: skills, most new-entity forms (agent, schedule, charter, review, request changes).
  - L 640: multi-step flows and long lists (add machine, provider selector, GitHub issue, raw error, attachment preview, new task).
- **Head**: 16px display title (`text-heading`) + an optional 12px `ink-3` subtitle line (`subtitle`); a 28px ghost close button in the top-right corner. The close button is last in the DOM, and initial focus lands on the first field.
- **Body**: the single scrolling box (`min-h-0`), with 20px left/right padding that also serves as room for the focus ring. The panel is capped at `100vh - 64px`; in short viewports the body scrolls and the foot stays on screen.
- **Foot (split)**: a 12px `ink-3` hint or status on the left (`hint`: doc links, shortcuts, waiting states, page numbers), the action group on the right. The primary action is the shadcn Button default (`primary` background, 32px, 8px corner, `DIALOG_PRIMARY_BUTTON`), the secondary action is a ghost text button (`DIALOG_TEXT_BUTTON`), and danger confirmations switch to `destructive`. With no hint the actions still align right. No background band, no divider line.
- **Grouped selector** (providers): a search box on top, then groups under small headings (`text-caption` 500 `ink-3`); each row is 40px = a 22px first-letter tile (white background + `line` ring) + name + an `ink-3` tag on the right (OAuth / not yet enabled). Hover and keyboard focus = the selector's selected row (white card + hairline ring). Disabled rows drop the text to `ink-3` and show no hover. Search filters across groups and whole empty groups hide; "Other · custom endpoint" is always there.
- **Menus** (one menu surface — `DropdownMenu` / `Popover` / the Select popup are the same surface, #1767): `popover` background, 18px radius (`--radius-popover`), 6px padding (`--menu-pad`), `--shadow-popover` (= `--e2`: soft shadow + 1px ring). Rows are 32px tall with a concentric 12px radius (`--radius-menu-item` = popover radius minus padding), 14px text, 15px `ink-3` icons, hover `menu-hover`; shortcut hints right-aligned in `text-caption` `ink-3`; dividers 1px, inset 6px left and right; group labels `text-caption` 500 `ink-3`. Danger rows use `destructive` for text and icon, hover `danger-soft`. Segmented controls inside menus use `SegmentedRadio` / `SegmentedTabs`; do not hand-roll them.
- Do: one width tier per dialog, hints left and actions right, equal-height menu rows. Do not: a dark or blurred backdrop, full-width submit bars, a gray-background foot band, outline secondary buttons, or small gray 12px menus.
- `e2e/paper-overlays.spec.ts` pins the backdrop color, the three widths, the split foot, the menu row height, and the grouped selector; `e2e/color-freeze.spec.ts` pins `dialog-backdrop` / `menu-hover`.

## Motion

The stone is quiet. Motion comes in four kinds, each with one duration and one easing; values come from the motion slots in `src/styles/shadcn.css` (`--dur-fast` / `--dur-overlay` / `--dur-window` / `--ease-standard` / `--ease-pop` / `--ease-out-expo` / `--ease-drawer` / `--spring-snappy`) or the tw-animate-css defaults. A new surface first finds its row in the table below; if none fits, it gets no motion. A new slot must ship with its consumer in the same PR.

| Kind | Surface | Duration | Easing | Animated properties |
|---|---|---|---|---|
| Micro-interaction | Hover and press tint on rows, cards and buttons; segmented controls; disclosure chevrons | 150ms (`--dur-fast`) | `--ease-standard` (same as tw `ease-out`) | `background-color` / `color` / `box-shadow` / `transform` |
| Micro-interaction | Task card hover lift and shadow | 200ms | `--ease-out-expo` | `box-shadow` / `translate` |
| Overlay | Dialog, confirmation surface, ⌘K | 200ms in and out (`--dur-overlay` / `duration-200`) | Default tw `ease` | `opacity` + `scale(.95→1)` |
| Overlay | Chief window grows from and returns to the lower-right launcher | 320ms in (`--dur-window`), 200ms out (`--dur-overlay`) | `--ease-drawer` (`cubic-bezier(.32,.72,0,1)`) | `opacity` + `scale(.4→1)`, origin at the launcher center |
| Overlay | Menu, popover, Select | 100ms in and out | Default tw `ease` | `opacity` + `scale(.95→1)` + 8px offset |
| Overlay | Tooltip | 150ms in and out (tw-animate default) | Default tw `ease` | `opacity` + `scale(.95→1)` + 8px offset |
| Overlay | Inline popovers (mention, slash, chip) | 100ms in, no exit | Default tw `ease` | `opacity` + `scale(.98→1)` |
| Arrival | New card on the board, column change, filter hit | 150ms | `--ease-pop` | `opacity` + `translateY(4px→0)` |
| Arrival | Conversation message entry | 380ms (`--spring-snappy-dur`) | `--spring-snappy` | `opacity` + `translateY` |
| Arrival | Streaming text reveal | 350ms | `--ease-out-expo` | `opacity` |
| Arrival | Saved check fade | 2.5s | `--ease-out-expo` | `opacity` + `scale` |
| Loop | Running task card footer and busy chief launcher: the spiral mark spins | 2.4s per turn | `linear` | `transform: rotate`; static under reduced motion |
| Loop | In-flight spinner pulse | 3.6s | `ease-in-out` | `opacity` + `scale` |

- Animate only `opacity` / `transform` / shadow / color, never layout properties (width / height / top).
- Instant, no transition: press (`:active` darkening, card background tint), everything under a coarse pointer, drop placement (`dropAnimation` is null, matching the reference sites), sidebar expand / collapse, theme switch (`.theme-suppress` turns transitions off for two frames).
- `prefers-reduced-motion`: every keyframe animation shrinks to 0.01ms and loops run once (the site-wide rule in `motion.css`); transitions are untouched.
- Not used: route transitions, list FLIP, cross-column flights, a spring family (only message entry uses `--spring-snappy`).
- Pins: `e2e/cds-motion.spec.ts` pins the motion slots and `anim-*` class names; `e2e/card-press.spec.ts` pins instant press; `e2e/color-freeze.spec.ts` pins `--ease-out-expo`.

## Dark

Dark is the `:root` default (`.light` is the light theme). Values live in the `colors-dark` frontmatter and in the `:root` block of `src/styles/shadcn.css`; the gallery's Doc check (`/design.html`) compares the two in both themes.

- **The same ladder, direction reversed**: in dark, higher elevation is brighter — `canvas` #141715 → `sheet` #1b1f1c → `card` #222723 → `popover` #262b27. The steps share one green-grey hue: deep stone, not a neutral gray. In light, menus share the card color (#fdfdfb); in dark shadows are weak, so menus are one brightness step above the card.
- **Hairline rings stay drawn**: `line` #353b36 is 1.32 on the card and 1.45 on the sheet.
- **The ink ladder inverts**: `ink` #e6e8e2, `ink-2` #b4bab3, `ink-3` #959c96, `icon` #959c96; `ink-4` #5d655f is decorative only.
- **Contrast (measured, WCAG 2.x)**: on the card, `ink` 12.30, `ink-2` 7.68, `ink-3` 5.41, `icon` 5.41, `accent` 8.14, `running-text` 7.92, `destructive` 7.00; `ink-3` on canvas 6.43 and on a hovered menu row 4.53.
- **Text on ochre is dark ochre**: `--text-on-accent` #1a1404 on the bright `accent` measures 9.83; dark project tiles carry #121513 text at 5.13 and up. Light mode uses white on the darker ochre and on the tiles.
- **Accent hover backgrounds are deep-dyed**: `accent-hover` #33290f, links on it 7.69; `spot-text-on-tint` #f2cf86 there 9.59.
- **The running green brightens**: icon #82b46f (6.30 on the card), text #9cc78b (7.92), bar #6fa35c on its track 4.28.
- **Dialog backdrop**: black at 50%, no blur; the dialog surface is `sheet`.
- **Status colors follow the same hues as light**: chips, diff rows, column dots and `badge-attention` use slate / ochre / lichen / rust in their dark steps; every chip text pair measures 7.0 or more.
- **Rule for new semantic tokens**: they must be defined in both `.light` and `:root` of `shadcn.css`; the dark side takes values from this ladder and is measured — never "the closest existing tier".

Dark adds one more slot, `--top` (an `inset 0 1px 0` top highlight at 5% white), spliced only into the `--e2` / `--e3` pools so lifted surfaces read as lit from above; in light it is a zero-alpha no-op (it is not written as `none`, because `none` mixed into a comma list would invalidate the whole box-shadow).

## Aesthetic constraints for agents (paste into prompts)

```text
Cairn UI rules (source: apps/web/DESIGN.md):
- Look: direction A, Cairn. Stone paper, dense, calm. Light (.light): canvas #e6e7e1 → sheet #f6f6f2 → card #fdfdfb, ink #1d231f. Hairline rings, almost no shadow. Elevation is three tokens with the ring baked in: --e1 card/row, --e2 menu/popover, --e3 dialog/floating window. Never add a second ring or a raw shadow.
- Dark (:root default): the same ladder in deep stone, lighter with elevation: canvas #141715 → sheet #1b1f1c → card #222723 → popover #262b27. Ink #e6e8e2 / #b4bab3 / #959c96. Accent #ebb550 with dark ochre text on it. Running #82b46f. All tokens live in src/styles/shadcn.css.
- Three meaningful hues: ochre (--card-button: light #9a6500, dark #ebb550) = waiting on you: action links, count badges; lichen green (running) = working/online; slate blue = ready for review. Status chips: idle neutral, plan slate, confirm ochre, done lichen, failed rust. Everything else is ink greys.
- Type: Bricolage Grotesque (font-heading, 650) for brand, page, pane and dialog titles and the Coordinator greeting; Instrument Sans for everything else; JetBrains Mono for code, times, ids. Chinese falls back to PingFang SC. Sizes only 26/20/17/14/12.5/12; body weight 450, titles 650.
- Spacing on the 4px grid. No arbitrary px values (text-[13px], ml-[10.5px]).
- Every status = icon + color + label. Every icon draws at stroke 1.75 (`test/icon-stroke.test.ts` pins `src/icons`). The spiral mark is the brand and the Coordinator avatar.
- Primary button = shadcn default Button on --primary (light #233127 with #f4f6f1 text, dark #e6e8e2 with dark text), 8px corners, 32px tall. Card actions = accent text links. No solid buttons on cards except the one primary action of a thread card.
- Radii: menu and dialog 18px, card and composer 14px, menu row 12px, button, input and row 8px.
- Dialogs: DialogShell with size s (400) / m (480) / l (640), light dim backdrop (no blur), 17px display title + optional 12.5px sub-line, split footer (12px ink-3 hint left, actions right, primary button). Menus: popover color, 18px corners, 6px padding, 32px rows with 12px corners, 14px text, 15px ink-3 icons, --menu-hover, danger rows in destructive.
- Segmented controls only from components/segmented.tsx: SegmentedTabs for view switches, SegmentedRadio for value pickers. Canvas track, white selected option with a 1px ring, inset keyboard ring. Never hand-roll role=tab/radio or restyle TabsList.
- One card corner: --radius-card (14px) on every card-like surface. Pages compose EmptyState / SettingsHeader+SettingsCard+SettingsRow / FormStack+FormField+FormActions; no tinted icon tiles, no full-width submit bars, no two-tone cards, no pill buttons.
- Use components/ui primitives and tokens; no hex in components.
```

## Migration status

Direction A's tokens are in code; the page structure (project sidebar, Coordinator home, Threads inbox, thread pane, settings tabs) lands through the B-UI batch, with prototype A as its acceptance reference. Until then the shell below is the old board shell on the new tokens. New code takes its values directly from this file.

## Current shell and board surface

The application shell is edge-to-edge: the main surface has no sheet margin, rounded corners, ring, or shadow overlay. The sidebar keeps `--surface-1` and is separated from the main surface by one `border-border` hairline. Expanded sidebar rows are 36px tall, use 14px UI text at weight 500 in `ink`, 18px icons at stroke 1.75 in the row ink, and a flat `--hover-1` selected state. The new-task row uses a filled `--card-button` circle for its plus icon and does not display a keyboard badge; the `C` shortcut remains active.

The board top bar has no bottom rule. Its primary action is a centered new-task bar with the spiral brand mark, the translated prompt `新任务：接下来让 agent 做什么？`, and a `C` key badge. The bar opens the existing new-task surface. When attention cards exist, the `needs-you-strip` appears below it, capped at five rows. Each row exposes the task title, project and sequence metadata, the attention label, the same primary action as the task card, and an `打开` link. A last-seen summary uses `cairn.board.lastSeenAt` and only renders when completion or failure transitions occurred since that timestamp.

On phones up to 640px, the sidebar folds into a drawer opened by a 44px menu button at the top left (top bars reserve 52px for it; the task detail page keeps its back chevron instead). Board columns become one vertical list, empty columns and the old empty start ghost are hidden, and horizontal board scrolling is disabled. The new-task bar is fixed above the safe-area inset at the bottom of the viewport, with the chief launcher above it. The needs-you strip remains before the board list.

The chief launcher in the lower-right corner sits on the card surface (`bg-card`) with body ink and the `--fab-shadow` (= `--e2`) elevation, rising to `--e3` on hover. The unread dot is a 6px `--card-button` fill inside the pill, and the pill label (`N 条新消息`, `思考中…`) uses `text-content-secondary`. No dark brand disc: the page keeps one calm surface family.
