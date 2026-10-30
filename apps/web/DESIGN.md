---
name: Cairn
direction: Pine & Brass · Paper Dense · Grouped sidebar · Hybrid type
reference: docs/board-paper-r5.html?v=3
reference-dark: docs/board-paper-dark.html
colors:
  # Light (.light), Pine & Brass: barely warm stone paper, pine-black ink, a pine primary and one brass accent; dark values live in colors-dark, rules in the "Color" and "Dark" sections
  canvas: '#f1f0eb'        # app background: the paper the sidebar sits on
  sheet: '#f9f8f4'         # main surface (--background)
  card: '#fefefb'          # task card
  popover: '#fefefb'       # menus and dialogs share the card color in light
  hover: '#e8e6e0'         # sidebar row hover (--sidebar-hover)
  line: '#dfded7'          # hairline ring; the column heading underline and topbar border use the same --border
  rule: '#dfded7'
  divider: '#dfded7'
  ink: '#14261e'           # headings and body text: pine-black
  ink-2: '#465048'         # secondary text (nav, buttons, descriptions)
  ink-3: '#666b62'         # meta information (project, time, counts)
  ink-4: '#a5a59e'         # decorative icons only, never text
  icon: '#85877f'          # icons with a text label (sidebar nav, column headings)
  accent: '#926300'        # brass (--card-button): needs-you states, action links, count badges, active icons
  primary: '#143e2e'       # primary button: the pine of the Cairn icon
  on-primary: '#f7f2e2'    # primary button text: the icon cream
  on-accent: '#ffffff'     # text on count badges and project tiles
  accent-hover: '#fbf4e4'  # action link hover background
  menu-hover: '#f1f0eb'    # menu row hover background
  backdrop: 'rgb(16 32 26 / 0.18)'  # dialog backdrop (pine-ink dim, no blur)
  running: '#348f4f'       # running icon, online dot
  running-text: '#206b38'  # running description text
  running-bar: '#40a35c'
  running-track: '#dfded7'
  project-tiles: ['#46703d', '#8a5f18', '#496684', '#9d5035', '#774c73', '#287070']
colors-dark:
  # Dark (:root default): the same ladder in deep pine, brighter with elevation
  canvas: '#0a110e'
  sheet: '#101814'
  card: '#18201c'
  popover: '#1f2924'       # menus and dialogs: one more step brighter than the card
  hover: 'rgb(235 245 238 / 0.05)'  # sidebar row hover: pale pine-white at 5% over canvas
  line: '#2b3631'          # hairline ring, column heading underline, and topbar bottom border are the same line
  rule: '#2b3631'
  divider: '#2b3631'
  ink: '#edebe2'
  ink-2: '#bcbfb5'
  ink-3: '#9aa198'
  ink-4: '#636b65'         # decorative icons only, never text
  icon: '#838c85'
  accent: '#e4b65c'        # brass brightened; text on it is the on-accent deep pine, not white
  primary: '#ebe5cf'       # primary button is cream in dark
  on-primary: '#0c1f17'
  on-accent: '#071a13'
  accent-hover: '#372c19'  # brass dyed into the card background
  menu-hover: '#26312c'
  backdrop: 'rgba(0, 0, 0, 0.45)'
  running: '#68ca80'
  running-text: '#8fd89e'
  running-bar: '#54b66e'
  running-track: '#2b3631'
  project-tiles: ['#89bb7e', '#dcaf61', '#89afd6', '#e5946f', '#c293bd', '#69bbba']
typography:
  page-title:   { fontFamily: sans, fontSize: 18px, fontWeight: '500' }
  heading:      { fontFamily: sans, fontSize: 16px, fontWeight: '500' }
  brand:        { fontFamily: serif, fontSize: 16px, fontWeight: '600' }
  card-title:   { fontFamily: sans, fontSize: 14px, fontWeight: '500', lineHeight: '1.5' }
  ui:           { fontFamily: sans, fontSize: 13.5px, fontWeight: '400' }
  meta:         { fontFamily: sans, fontSize: 12px, fontWeight: '400' }
  caption:      { fontFamily: sans, fontSize: 11.5px, fontWeight: '500' }
  code:         { fontFamily: mono, fontSize: 12px, fontWeight: '400' }
fonts:
  serif: var(--font-source-serif)   # sourceSerif4 → Georgia → Songti SC
  sans: var(--font-inter) + PingFang SC
  mono: var(--font-jetbrains-mono)
rounded:
  field: 8px         # rounded-md: inputs, selects, segmented tracks, dialog and form primary buttons
  control: 10px      # --radius-control = rounded-lg: default Button, icon buttons, project avatars
  menu-item: 12px    # --radius-menu-item = menu radius minus the 6px menu padding
  sheet: 16px        # --edge-radius: dialogs, ⌘K
  menu: 18px         # --radius-popover: menus, floating surfaces, dropdowns
  bubble: 18px       # --radius-bubble: user chat bubble
  card: 20px         # --radius-card: one corner for every card-like surface
  composer: 20px     # --radius-composer
  window: 20px       # --radius-window: chief window
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

Cairn is an orchestration board for multi-lane coding agents. The user is a keyboard-first engineer who opens the board dozens of times a day; the core question is "what is waiting for me".

Final direction: **Pine & Brass — paper, dense, one accent color**. The paper splits into three layers (canvas base → sheet main panel → cards); hierarchy comes from background depth plus hairline rings, not heavy shadows. Neutrals are barely warm stone in light and deep pine in dark, so the page reads calm rather than sepia or gray. Three hues carry meaning and nothing else does: pine is the brand and the primary button, brass `accent` means "needs you" and is actionable, leaf green `running` means "running". Everything else is the ink ladder.

Reference mockup: [`docs/board-paper-r5.html`](docs/board-paper-r5.html); open it in a browser and press `3` to switch to the final Hybrid version (static HTML; number keys 1–4 switch between comparison drafts). When the mockup and this file disagree, this file wins.

## Colors

- **Three paper layers**: `canvas` (app background; the sidebar sits directly on it) → `sheet` (main surface) → `card` (near-white task card, `#fefefb` in light).
- **One file for theme values**: every value that differs between light and dark — colors, shadow tints, the elevated ring — lives in `src/styles/shadcn.css` (`:root` dark, `.light` light). `src/styles/tokens.css` holds only theme-independent tokens (motion, z-index, type, radii, sizes) and formulas over the color slots, such as the drop-target tint built from `--card-button`. A palette change therefore touches one file.
- **Borders are always 1 CSS pixel**: the main panel, task cards, the active nav item, and the new-task button stay 1px on high-density screens too (they do not follow `--hairline` down to 0.5px); borders must be visible.
- **Three-tier shadow ladder** (`tokens.css`, #1428): `--e1` cards and rows, `--e2` menus and floating surfaces, `--e3` dialogs and floating windows. Each tier carries its own 1px ring at the end (`--e1` uses `line`; `--e2`/`--e3` use `--elevated-ring`, which is `--border-soft` in light and `--ring-inset-highlight` in dark, where `line` is invisible on the surface base). Light shadows are tinted pine-ink (`rgb(16 32 26 / a)`) rather than neutral black so they sit in the paper, and no extra border is drawn on the surface; surfaces that draw their own `--edge-ring` (the notification strip, the chief window, the FAB) take the pool of the same tier: `--cds-shadow-sm` / `-md` / `-lg` — one ring per edge. Old slot names like `--panel-shadow` / `--shadow-popover` / `--dialog-shadow` are aliases; the hover / focus slots are states, not tiers.
- **Four ink steps**: `ink` headings and body text; `ink-2` nav, buttons, descriptions; `ink-3` meta information; `ink-4` decorative icons only. The lightest text ever uses is `ink-3`.
- **Contrast (light, measured, WCAG 2.x)**: on the card, `ink` is 15.68, `ink-2` 8.31, `ink-3` 5.41, `accent` 4.69, `running-text` 6.45, `destructive` 5.97; `icon` is 3.60 (the 3:1 non-text gate); `ink-3` on canvas is 4.79. White text on the `accent` background is 4.73; `on-primary` on `primary` is 10.67. `ink-4` is decorative only. `ink-3` on `--secondary` (light `#edebe5`, the same value as the shadcn surface variables `--muted` and `--accent` — the latter is not the brand color `accent`; the secondary backgrounds are input-box cards, diff block headers, tool-call pills, and the like) is 4.58 and `ink-2` there is 7.04 (#1442, guarded by `e2e/a11y-axe.spec.ts`). White text on the six light project tiles measures 5.63–6.85. Action links swap to `spot-text-on-tint` on the `accent-hover` background, because `accent` on it drops to 4.32.
- **Focus ring**: `--focus-ring` is pine `#205943` in light (8.1 on the card) and brass `#e4b65c` in dark, so keyboard focus never reads as "needs you" in light.
- **Brand marks keep the icon colors**: the chief launcher disc (`--fab-surface` `#173a2f`, `--fab-mark` `#f2ead7`) uses the exact colors of the Cairn app icon in both themes; `--primary` is the nearest UI pine, not the icon file.
- **Status chips use five distinct hues**: idle neutral, plan slate blue, confirm brass, done leaf green, failed rust (`--chip-*-bg` / `--chip-*-fg`, every pair 6.6+ in light and 7.8+ in dark). Plan is deliberately not brass: only "needs you" may look like the accent.
- **Accent discipline**: `accent` is used only for: needs-your-attention states and counts, action links on cards, icons of the active nav item, and count-badge backgrounds. It is never decorative and never a large-area background.
- **Status is never color alone**: every status is a triple of "icon + color + text" (failed ⊗ failed / awaiting confirmation ☰ awaiting confirmation / awaiting review ⑂ awaiting review); color-blind users can tell them apart by icon and text.
- **The primary button is `primary`**: the shadcn Button default tier. In light it is the icon pine `#143e2e` with cream `#f7f2e2` text; in dark it is cream `#ebe5cf` with deep pine text. Brass is never the primary-button background, so "do this" and "needs you" never look alike.
- Colors live only in the token files (`src/styles/shadcn.css` / `tokens.css`); components write token names, never hex values (`scripts/ui-drift-gate.mjs` G2 already pins this).

## Typography (Hybrid)

- **Serif only for the brand**: the sidebar brand name and the chief panel greeting (`var(--font-source-serif)`, Chinese falls back to Songti SC). This matches claude.ai, which keeps serif for its wordmark and greeting.
- **Everything else is sans**: page titles, task titles, column headings, dialog titles, card titles, navigation, buttons, meta. Font Inter, Chinese falls back to PingFang SC. A serif Latin title next to sans Chinese reads as two styles in one line, which is why titles are sans.
- **Six font sizes, no seventh allowed**: 18 page title / 16 column headings and brand / 14 card title / 13.5 UI text / 12 meta / 11.5 badges and group labels. In code, use the corresponding Tailwind theme keys `text-page` / `text-heading` / `text-card-title` / `text-ui` / `text-meta` / `text-caption` (heading font `font-heading`), never arbitrary values like `text-[13px]`; `scripts/ui-debt-gate.mjs` D5 only allows the total count of arbitrary values to decrease.
- **Three font weights**: 400 body text, 500 card titles and active items, 600 count badges and brand. 700 is not used.
- The title of a completed task drops to 400 + `ink-3`, meaning "no longer needs to be read".

## Layout and spacing

- 4px grid. Common values: 4 / 8 / 12 / 16 / 24. Card padding 12×14, card gap 8, column gap 16, board padding 18×24.
- Top bar 56px: serif page title on the left + "⚠ N items need your attention"; text buttons on the right (filter, schedules) + the ink primary button "New task". All top-bar elements are `nowrap` and do not wrap in narrow windows.
- Sidebar 248px, sitting on `canvas`; the main surface fills the rest edge to edge (see "Current shell and board surface").
- One screen has only one primary action (the primary button); the rest are text buttons or `accent` links inside cards.

## Icons

- Icon library lucide (configured in `components.json`), stroke 1.75.
- Sizes: meta 12, card actions and status 13, top-bar buttons 14, column headings 15, sidebar nav 16.
- Colors: meta icons and collapse arrows use `ink-4` (`text-content-dim`); icons with a text label (sidebar nav, column headings) use `icon` (`text-icon`); pure-icon buttons without a text label (search, collapse sidebar, collapsed sidebar icons) use `ink-3`, preserving the 3:1 non-text contrast; icons of the active nav item and anything "needs you" use `accent`; running-related icons use `running`.
- Shapes: workbench = three columns (Columns3); collapse/expand sidebar = panel (PanelLeft, no arrow).
- Column heading icons are fixed: `待开始` = dashed circle, `执行中` = pulse line, `待处理` = exclamation circle, `已完成` = check circle.

## Components

### Sidebar (Grouped)
From top to bottom:
1. **Workspace row**: spiral mark (`public/logo-mark.svg` as a mask, 16px, taking the row ink `ink`) + serif brand name + dropdown arrow; two icon buttons on the right: search (⌘K) and collapse sidebar.
2. **New-task button**: see "Current shell and board surface" below. It is an action, not a nav item.
3. **Work nav**: workbench, needs my attention (`accent` count badge on the right), schedules. Active item = `accent` icon.
4. **Projects**: group label "Projects" + plus on the right; each project is one row = colored first-letter tile (colors taken in order from `project-tiles`) + name + unfinished count.
5. **Footer**: one "Resources" row (skills / MCP / keys / machines / providers collapsed inside, expanding into an indented sub-list on click); user row = avatar + name + second line "● 2 machines online · N running".

### Board columns
- Column header: status icon + sans column name + `ink-3` count; hovering the `待开始` column shows a plus on the right (new tasks land only in that column; other columns get no plus). A `rule` line sits below.
- An empty column says what is missing in one plain sentence (`还没有待开始的任务`, `没有在跑的任务`, `没有等你处理的事`, `最近 7 天还没有完成的任务`), never a bare `暂无`. The empty `待开始` column instead shows one dashed ghost card, `写下想做的事` with the `C` key cap, which opens the new-task dialog.
- While the first board read is in flight, each column shows two skeleton cards (registry `Skeleton`) in the card shape, so the layout does not jump when data lands.

### Task card
- `card` surface, 20px corner (`--radius-card`), a `line` 1px hairline ring plus one very light pine-ink shadow (`0 1px 2px`, 5% in light; together they are `--e1`), so the edge is crisp, never soft. On hover the ring deepens and the shadow rises to `0 6px 16px -2px` at 9% (150ms ease-out). No second large blur shadow.
- In-flight orchestration (start was pressed, the chief has not dispatched yet): a todo card swaps `开始` for a footer `编排中 · reason` (waiting for X to come online / missing capability / queued) plus `查看会话` on the right; a failed card swaps `重试` for an inert `编排中`. Nothing is layered over the meta line.
- A failed orchestration shows a short plain summary (`orchestrationErrorSummary`: connection dropped, timed out, out of quota, context too long, bad key, provider unavailable); the raw provider error stays in the `title` tooltip and never wraps character by character on the card.
- Structure: title (at most two lines), then one meta line (project, #number, tag, time; never wraps; when space runs out the tag truncates first and the project keeps at least five characters), then a footer by status. The tag icon uses the user's tag color; the tag name uses the meta ink.
- The right-side meta icons (plan, changes, chief-created, branch) stay hidden until the card is hovered or focused, and are always visible on touch screens (`pointer-coarse`).
- Footer:
  - Three pending states: dashed divider + status icon and name (ochre) + reason (truncated) + an ochre action link on the right (retry / confirm plan / review).
  - Running: robot icon (slow breathing) + `agent · current step` + `3/7` on the right, with a 3px progress bar below. Queued cards (started, waiting for a machine) live in this column too: a still hourglass + secondary ink `agent · 排队中`, switching to `等机器 / 等额度` when suspended; no breathing, which is reserved for cards that are really running.
  - Todo: only cards that have not started. No footer; `开始` floats at the right of the meta line on hover and takes no height.
  - Done: no footer, title demoted.
- No solid buttons on cards.

### Buttons
- Primary button: shadcn Button default tier, `primary` background, 10px radius (`rounded-lg` = `--radius-control`), 32px tall. Inside dialogs, forms and empty states `DIALOG_PRIMARY_BUTTON` narrows the corner to 8px (`rounded-md`).
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
- The composer is a white card (`--card`) with the pine-ink `--shadow-composer` ladder and a `--border-soft` ring; it is the one white surface in the conversation because it is where you act. The idle send button has no fill; only the stop button gets the `seg-active` square.

## Page patterns

Pages like settings, resources, team, and project share the pieces below. A new page composes these pieces first and does not build its own cards, empty states, or forms inside the page. All pieces live in `src/components/`; all values go through tokens and the six font sizes.

### Card radius: one corner
- **Token**: `--radius-card` = 20px (`rounded.card`), the class `rounded-(--radius-card)`, or `CARD_RADIUS_CLS` exported by `settings-list.tsx`.
- **Used on**: every card-like surface — task cards, cards being dragged, settings cards, team / agent cards, grouped resource-row cards, one-off notice cards.
- **Not in this list**: dialogs and the ⌘K panel are the sheet tier at 16px (`--edge-radius`); menus and floating surfaces use `--radius-popover` (18px, see "Dialogs and menus" below); buttons, icon buttons and project avatars are 10px (`--radius-control`); inputs and selects are 8px (`rounded-md`).
- The registry `Card` ships with `rounded-xl` (14px), which must be replaced with `--radius-card` when used as a card.
- Do: one corner for all cards on a page. Do not: write 12px / 14px cards into a page, or mix two card corners on one page.

### Empty state
Piece: `EmptyState` in `src/components/empty-state.tsx` (the base is the registry `Empty`).
- **Icon**: a lucide line icon, 24px, stroke 1.75, `ink-3` (`text-content-tertiary`), no background tile.
- **Title**: `h2`, `text-card-title` 500 `ink`.
- **Description**: `text-meta` `ink-3`, at most 320px wide (about 44ch), centered, `text-balance`.
- **Primary action** (optional): shadcn Button default tier, `primary` background, 32px, 8px corner (`DIALOG_PRIMARY_BUTTON`). An empty state has at most one primary action.
- **Hint line** (optional): one `text-meta` `ink-3` line below the primary action, optionally preceded by a 12px icon (`ink-4`), explaining read-only or permission reasons.
- **Used on**: list pages with no data (API keys, schedules, skills, MCP, keys…). The copy is translated by the caller before being passed in.
- Do: a bare icon + title + one sentence. Do not: an icon tile with a colored background (neither orange nor beige), a `size="sm"` small button, two side-by-side primary buttons, or a "View docs" external link.

### Settings list
Pieces: `src/components/settings-list.tsx`. The account page's "edit name" header is in `src/components/profile-card.tsx` (`ProfileHeader`, composing `SettingsHeader`).
- **Header above the card** (`SettingsHeader`): 56px white circular avatar (`line` 1px ring) + serif title (`text-page` 500) + a `text-meta` `ink-3` description below; one optional action on the right (usually a text button). The name is not repeated as a row inside the card. For inline renaming, `editor` replaces the title, description, and action.
- **One card** (`SettingsCard`): white background, `line` 1px outer ring, `--radius-card`; rows carry no background color (no two-tone cards).
- **Row** (`SettingsRow`): minimum height 52px, 16px left and right; a `text-ui` `ink` label on the left (optionally with one `text-meta` `ink-3` description line), controls on the right. Rows with two-line content grow naturally. Custom rows that do not go through `SettingsRow` use `SETTINGS_ROW_CLS`.
- **Dividers are drawn only between rendered rows**: `divide-y` on the card, rows rendered conditionally, never hidden with CSS. A hidden row is still a sibling node and would draw a second border at the top of the card.
- **Controls are framed, one kind each**: dropdown = white background + `line` 1px ring + 8px radius + 32px tall (`SETTINGS_SELECT_TRIGGER_CLS`, the same string as the form's `FORM_CONTROL_CLS`); single-choice segmented = `SettingsSegmented` (i.e. `SegmentedRadio`, see "Segmented control" below); switch = shadcn Switch with ink on-state.
- **Danger zone** (`SettingsDangerZone`): a separate card at the very end of the page, one row: label + description on the left, a Button with `variant="destructive"` on the right, 32px with the standard 10px button corner. Clicking opens a confirm layer first; it never deletes directly.
- Do: header + one card + equal-height rows. Do not: a large avatar occupying a row, rows with background tints, a rounded-pill delete button, or danger actions mixed into ordinary settings cards.

### Forms
Piece: `src/components/form-layout.tsx` (the base is the registry `Field` family).
- **Stack** (`FormStack`): fields stacked vertically, 16px between fields, at most 520px wide, left-aligned.
- **Field** (`FormField`): label on top (`text-ui` 500 `ink`, `htmlFor` pointing at the control), the control, and an optional help line (`text-meta` `ink-3`) below.
- **Controls**: Input / SelectTrigger with `FORM_CONTROL_CLS`: 32px tall, white background, `line` 1px ring, 8px radius, `text-ui`.
- **Action row** (`FormActions`): the last row of the form, right-aligned; an optional text button (such as `取消`) on the left, the shadcn Button default primary on the right. When the form cannot submit, the button's own `disabled` state paints it `secondary` with secondary ink at full opacity (`DIALOG_PRIMARY_BUTTON`); no separate gray bar.
- Do: a narrow column, labels on top, the primary button on the right. Do not: inputs spanning the whole column, full-width gray submit bars, or two-column forms with labels beside inputs.

### Segmented control
Piece: `src/components/segmented.tsx`. One appearance, two semantics:
- **`SegmentedTabs`**: switches views — each option controls a panel or a route (agent overview / memory / permissions, project tasks | files, files | history, list | grid, team grid | org chart, provider runtime, branch dialog, chief settings). The base is the registry `Tabs`, keeping `tablist` / `tab` semantics.
- **`SegmentedRadio`**: picks a value in a form or settings (appearance in the user menu, schedule frequency). `radiogroup` / `radio` semantics; arrow keys move and select, roving tabindex. Use it for "selecting a value that will be persisted"; use tabs for "which block to look at".
- **If it does not fit, switch to a dropdown**: when the option labels at 12px padding do not fit the column width, do not shrink the text and do not truncate — use the form Select instead (`SelectTrigger` + `FORM_CONTROL_CLS`). Example: the API protocol in the new-provider dialog (the three protocol names need about 460px; the dialog column is 416px wide).
- **Appearance**: track 32px tall, 2px inset, 8px radius, background `canvas` — one paper token; options 28px tall, 6px radius, 12px left/right padding for text options, and pure-icon options are 28px squares (must carry an `ariaLabel`). Unselected text is `ink-2`, turning to `ink` on hover, with no background tint; the selected option = white background (`card`) + `line` 1px ring + one extremely light shadow, text 500 `ink`. The accent is not used. Disabled items use the primitive's own translucency.
- **Focus**: mouse clicks show no ring. Keyboard `:focus-visible` is a 2px `--focus-ring` ring, **inset** inside the option box (`outline-offset: -2px`, the `[data-segmented="option"]` rule in `styles/app.css`): options are only 2px apart, and an outer ring would press onto the neighbor.
- **Sliding**: `slide` makes the white tab slide between options on a 150ms underlying pill (only chief settings uses it, #644).
- Do: assemble every segmented control from these two pieces; e2e handles attach via `className` (track) and `optionHandle` (option). Do not: hand-write `role="radiogroup"` / `role="tab"`, or restyle `TabsList` / `TabsTrigger` directly in a page — `scripts/ui-drift-gate.mjs` G7 will block it.

### Dialogs and menus
Pieces: `src/components/ui/dialog-shell.tsx` (`DialogShell` + the exported `DIALOG_*` pieces, `DialogFootRow`, `dialogWidth`), `alert-dialog-shell.tsx` (confirm surfaces), `dropdown-menu.tsx` / `popover.tsx` (menus and floating surfaces). `dialog.tsx` / `alert-dialog.tsx` / `select.tsx` are pristine registry pieces; their Paper skin lives in the `[data-slot=…]` rules and tokens of `styles/app.css`.
- **Backdrop**: one layer of light-ink dim `--dialog-backdrop` (light `rgb(16 32 26 / 0.18)`), no blur. All dialogs, confirm surfaces, and ⌘K share this layer; there is no dark curtain.
- **Surface**: `sheet` background (`--dialog-surface`), 16px radius (`--edge-radius`), `--dialog-shadow` (= `--e3`: two soft shadows + a 1px `line` ring).
- **Three widths** (`size`, `--dialog-w-*`, clamped with `min(100% - 2rem, …)` on narrow screens):
  - S 400: keys, API keys, delete and other confirmations, short forms.
  - M 480: skills, most new-entity forms (agent, schedule, charter, review, request changes).
  - L 640: multi-step flows and long lists (add machine, provider selector, GitHub issue, raw error, attachment preview, new task).
- **Head**: 16px serif title (`text-heading`) + an optional 12px `ink-3` subtitle line (`subtitle`); a 28px ghost close button in the top-right corner. The close button is last in the DOM, and initial focus lands on the first field.
- **Body**: the single scrolling box (`min-h-0`), with 20px left/right padding that also serves as room for the focus ring. The panel is capped at `100vh - 64px`; in short viewports the body scrolls and the foot stays on screen.
- **Foot (split)**: a 12px `ink-3` hint or status on the left (`hint`: doc links, shortcuts, waiting states, page numbers), the action group on the right. The primary action is the shadcn Button default (`primary` background, 32px, 8px corner, `DIALOG_PRIMARY_BUTTON`), the secondary action is a ghost text button (`DIALOG_TEXT_BUTTON`), and danger confirmations switch to `destructive`. With no hint the actions still align right. No background band, no divider line.
- **Grouped selector** (providers): a search box on top, then groups under small headings (`text-caption` 500 `ink-3`); each row is 40px = a 22px first-letter tile (white background + `line` ring) + name + an `ink-3` tag on the right (OAuth / not yet enabled). Hover and keyboard focus = the selector's selected row (white card + hairline ring). Disabled rows drop the text to `ink-3` and show no hover. Search filters across groups and whole empty groups hide; "Other · custom endpoint" is always there.
- **Menus** (the Paper menu — `DropdownMenu` / `Popover` / the Select popup are the same surface, #1767): `popover` background, 18px radius (`--radius-popover`), 6px padding (`--menu-pad`), `--shadow-popover` (= `--e2`: soft shadow + 1px ring). Rows are 32px tall with a concentric 12px radius (`--radius-menu-item` = popover radius minus padding), 13.5px text, 15px `ink-3` icons, hover `menu-hover`; shortcut hints right-aligned in `text-caption` `ink-3`; dividers 1px, inset 6px left and right; group labels `text-caption` 500 `ink-3`. Danger rows use `destructive` for text and icon, hover `danger-soft`. Segmented controls inside menus use `SegmentedRadio` / `SegmentedTabs`; do not hand-roll them.
- Do: one width tier per dialog, hints left and actions right, equal-height menu rows. Do not: a dark or blurred backdrop, full-width submit bars, a gray-background foot band, outline secondary buttons, or small gray 12px menus.
- `e2e/paper-overlays.spec.ts` pins the backdrop color, the three widths, the split foot, the menu row height, and the grouped selector; `e2e/color-freeze.spec.ts` pins `dialog-backdrop` / `menu-hover`.

## Motion

The paper is quiet. Motion comes in four kinds, each with one duration and one easing; values come from the motion slots in `src/styles/tokens.css` (`--dur-fast` / `--dur-overlay` / `--dur-window` / `--ease-standard` / `--ease-pop` / `--ease-out-expo` / `--ease-drawer` / `--spring-snappy`) or the tw-animate-css defaults. A new surface first finds its row in the table below; if none fits, it gets no motion. A new slot must ship with its consumer in the same PR.

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

- **The same ladder, direction reversed**: in dark, higher elevation is brighter — `canvas` #0a110e → `sheet` #101814 → `card` #18201c → `popover` #1f2924. The four steps share one hue (OKLCH hue 165, chroma 0.013–0.016): deep pine, not a neutral gray. In light, menus and floating surfaces share the card color (#fefefb); in dark shadows are weak, so menus and floating surfaces are one brightness step above the card, layered by brightness difference plus hairline rings. The sidebar sits on `canvas` through `--surface-1`, the same shape on both sides.
- **Hairline rings stay drawn**: `line` #2b3631 is 1.33 on the card and 1.44 on the sheet — the same single CSS pixel as in light, without relying on shadows.
- **The ink ladder inverts**: `ink` #edebe2 headings and body, `ink-2` #bcbfb5 nav and buttons, `ink-3` #9aa198 meta, `icon` #838c85 labeled icons; `ink-4` #636b65 is decorative only.
- **Contrast (measured, WCAG 2.x)**: on the card, `ink` 13.93, `ink-2` 8.92, `ink-3` 6.28, `icon` 4.80 (the 3 non-text gate), `accent` 8.83, `running-text` 9.89, `destructive` 6.82; `ink-3` on canvas 7.21; `ink-3` on a hovered menu row 5.09. `ink-4` is 3.03 on the card and remains decorative only.
- **Text on brass is deep pine**: with `accent` brightened to #e4b65c, white text is only 1.88, so text on count badges and project tiles goes through `--text-on-accent` = deep pine #071a13 (badge 9.56, the six tiles 7.03 and up). Light mode uses white text on the darker brass and on the tiles.
- **Accent hover backgrounds are deep-dyed, not light-dyed**: `accent-hover` #372c19 = brass dyed into the card background, with links on it at 7.25. The `spot-soft` selection background uses the same method; text on it is `spot-text-on-tint` #f0d49b, pale brass at 8.65.
- **The running green brightens**: icon #68ca80 (8.20 on the card), text #8fd89e (9.89), progress bar #54b66e on its track at 4.95; the track is simply the hairline.
- **Dialog backdrop**: black at 45%, no blur; the dialog surface is `popover`, the same tier as menus.
- **Status colors follow the same hues as light**: chips, diff rows, column dots and `badge-attention` use slate / brass / leaf / rust in their dark steps, and every text pair measures 7.8 or more on its own background.
- **Rule for new semantic tokens**: they must be defined in both `.light` and `:root` of `shadcn.css`; the dark side takes values from this ladder and is measured — never "the closest existing tier".

Dark adds one more slot, `--top` (an `inset 0 1px 0` top highlight at 6% white), spliced only into the `--e2` / `--e3` pools so lifted surfaces read as lit from above; in light it is a zero-alpha no-op (it is not written as `none`, because `none` mixed into a comma list would invalidate the whole box-shadow).

## Aesthetic constraints for agents (paste into prompts)

```text
Cairn UI rules (source: apps/web/DESIGN.md):
- Look: Pine & Brass. Paper, dense, calm. Light (.light): canvas #f1f0eb → sheet #f9f8f4 → card #fefefb, ink #14261e. Hairline rings, almost no shadow. Elevation is three tokens with the ring baked in: --e1 card/row, --e2 menu/popover, --e3 dialog/floating window. Never add a second ring or a raw shadow; --top (dark-only inset top highlight) rides e2/e3 only.
- Dark (:root default): the same ladder in deep pine, lighter with elevation: canvas #0a110e → sheet #101814 → card #18201c → popover #1f2924 (menus and dialogs). Ink #edebe2 / #bcbfb5 / #9aa198. Accent #e4b65c with dark pine text on it (badge, project tiles). Running #68ca80. Only token values differ between themes, and they all live in src/styles/shadcn.css.
- Three meaningful hues: pine = brand and primary button; brass (--card-button: light #926300, dark #e4b65c) = "needs you": action links, count badges, active icons; leaf green (running) = running/online. Status chips: idle neutral, plan slate, confirm brass, done green, failed rust. Everything else is ink greys.
- Type: serif (--font-source-serif) only for the brand name and the chief greeting. Everything else sans (Inter / PingFang). Sizes only 18/16/14/13.5/12/11.5. Weights 400/500/600.
- Spacing on the 4px grid. No arbitrary px values (text-[13px], ml-[10.5px]).
- Every status = icon + color + label. Lucide icons, stroke 1.75.
- Primary button = shadcn default Button on --primary (light pine #143e2e with cream text, dark cream with pine text), 10px corners (8px inside dialogs and forms), 32px tall. Card actions = accent text links. No solid buttons on cards.
- Radii: card 20px, menu 18px, dialog 16px, menu row 12px, button 10px, input 8px.
- Dialogs: DialogShell with size s (400) / m (480) / l (640), light dim backdrop (no blur), 16px sans title + optional 12px sub-line, split footer (12px ink-3 hint left, actions right, primary button). Menus: popover color, 18px corners, 6px padding, 32px rows with 12px corners, 13.5px text, 15px ink-3 icons, --menu-hover, danger rows in destructive.
- Segmented controls only from components/segmented.tsx: SegmentedTabs for view switches, SegmentedRadio for value pickers. Canvas track, white selected option with a 1px ring, inset keyboard ring. Never hand-roll role=tab/radio or restyle TabsList.
- One card corner: --radius-card (20px) on every card-like surface. Pages compose EmptyState / SettingsHeader+SettingsCard+SettingsRow / FormStack+FormField+FormActions; no tinted icon tiles, no full-width submit bars, no two-tone cards, no pill buttons.
- Sidebar = Grouped: workspace row (16px spiral mark from logo-mark.svg in ink, serif name), New task button, Workbench / Needs me / Schedules, Projects, collapsed Resources, user row with machine status.
- Use components/ui primitives and tokens; no hex in components.
```

## Migration status

Where the code's current state disagrees with this file, land the changes step by step in the order of `apps/web/docs/paper-redesign-plan.md`. New code takes its values directly from this file.

## Current shell and board surface

The application shell is edge-to-edge: the main surface has no sheet margin, rounded corners, ring, or shadow overlay. The sidebar keeps `--surface-1` and is separated from the main surface by one `border-border` hairline. Expanded sidebar rows are 36px tall, use 14px UI text, 1.5px icon strokes, and a flat `--hover-1` selected state. The new-task row uses a filled `--card-button` circle for its plus icon and does not display a keyboard badge; the `C` shortcut remains active.

The board top bar has no bottom rule. Its primary action is a centered new-task bar with the spiral brand mark, the translated prompt `新任务：接下来让 agent 做什么？`, and a `C` key badge. The bar opens the existing new-task surface. When attention cards exist, the `needs-you-strip` appears below it, capped at five rows. Each row exposes the task title, project and sequence metadata, the attention label, the same primary action as the task card, and an `打开` link. A last-seen summary uses `cairn.board.lastSeenAt` and only renders when completion or failure transitions occurred since that timestamp.

On phones up to 640px, the sidebar folds into a drawer opened by a 44px menu button at the top left (top bars reserve 52px for it; the task detail page keeps its back chevron instead). Board columns become one vertical list, empty columns and the old empty start ghost are hidden, and horizontal board scrolling is disabled. The new-task bar is fixed above the safe-area inset at the bottom of the viewport, with the chief launcher above it. The needs-you strip remains before the board list.

The chief launcher in the lower-right corner sits on the card surface (`bg-card`) with body ink and the `--fab-shadow` (= `--e2`) elevation, rising to `--e3` on hover. The unread dot is a 6px `--card-button` fill inside the pill, and the pill label (`N 条新消息`, `思考中…`) uses `text-content-secondary`. No dark brand disc: the page keeps one calm surface family.
