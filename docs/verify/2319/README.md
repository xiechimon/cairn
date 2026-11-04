# #2319 gallery components against prototype A

Each image puts the gallery specimen (left, `localhost:5311/design.html`, rebased on `93f1a9c`) next to the matching crop of frozen prototype A (right). There is one image per component per theme, and it stacks every state the specimen shows. Files are named `<component>--states--<light|dark>.png`.

| Component | States covered | Verdict |
|---|---|---|
| `stone-marks` | pebble per tone; stone mark per tone and kind, still; stone trail with filled and empty groups, collapsed groups | match; snoozed uses lucide `AlarmClockOff` instead of the prototype's hand-drawn glyph (product icon set) |
| `wait-pill-header` | wait pill; header icon button default, active, attention dot | match |
| `thread-card` | waiting question, waiting plan, working, ready for review, merged | match after fix: every state now shows View thread, as the prototype's working card does |
| `thread-row-bulk` | waiting rows raised, review row with PR tag, working age, snoozed idle row, selected row, bulk bar | match; bulk bar snooze icon is lucide; the row menu slot is empty (the menu itself is a product component) |
| `permission-card` | pending; allowed once, denied, always allowed | match; command block uses `bg-canvas` because there is no `sunk` token (see below) |
| `proposal-card` | proposed, applied (click through) | match |
| `plan-usage-next` | Approve plan and Edit plan, approved line; usage strip; next-step buttons | match |
| `pr-bar` | CI passed, running, failed, merged | match after fix: branch text uses secondary ink |
| `pr-popover` | checks popover open: on, off with dynamic help, locked row | match after fix: help text is caption size, locked label is tertiary ink; toggles are `ToggleSwitch` (deliberate: product switch, its off thumb differs from the prototype in dark) |
| `scheduled-task-row` | active, paused, auto-disabled | match after fix: rows are divided again (the button border hid the list dividers) |
| `sidebar` | nav rows with key hints, active nav row, project rows with waiting count, open project with nested threads, open and snoozed thread rows, user footer | match after fixes: plain key hints instead of key caps, rounded-square project tiles, add button on the Projects label; the cairn brand header belongs to the shell page step |
| `project-card` | project card with waiting chip, without, archived | match after fix: quiet menu button |
| `list-rows` | three rows with icon, subtitle and trailing time | match |
| `phone-tab-bar` | inbox badge, Coordinator active | match after fix: Coordinator uses the product spiral mark and is the default tab |
| `danger-zone` | delete row with danger outline | match for the row; the archive row and danger titles come with the settings page step |
| `stream-header` | day divider, goal line, greeting, suggestion chips | match after fix: the specimen sits on the card stage so the goal line's canvas fill shows; greeting is 20px against the prototype's 22px because the type scale has no 22px step |
| `archived-banner` | banner with Unarchive | match after fix: card stage shows the fill |
| `routing` | routing nodes, fallback note, unavailable nodes, quota bars at normal and hot levels | match for nodes and bars; the connector curves between columns are page work for the settings step |

## Needs an owned-file change

- A `sunk` surface token (light `#eceee8`, dark `#181b19`) would match the prototype's command block and banner fill exactly. Today `bg-canvas` stands in; adding the token is a `shadcn.css` change for the design session.
- `ToggleSwitch` off thumb in dark is light, while the prototype keeps it dark. This is a product component owned by the design session.

## Prototype-A differences from existing product components

These components were dropped from step 0 because the product already has them. Differences are listed for the page steps and the design session; nothing here is built.

- **Composer** (`detail/composer.tsx`): the prototype footer shows the model and effort (`Opus 5.5 High`), a `+` attach button and an inline key hint (`↵ send`, or `↵ steer · ⌘↵ queue` inside a running thread); the product composer has no inline key hint.
- **Queued messages** (`detail/queued-messages.tsx`): the prototype shows queued follow-ups as chips inside the composer, above the input, each with a clock icon, a send-now arrow and a remove button; the product renders them as right-aligned message bubbles in the transcript with a queued footer and a cancel action.
- **⌘K search panel** (`overlay/search-panel.tsx`): the prototype palette has a footer with key hints and sections for threads, projects, scheduled tasks and actions; the product panel has go-to, task and project sections and no footer.
- **Row and project menus** (`overlay/more-menu.tsx`, `overlay/slash-menu.tsx`): prototype menu rows carry single-key hints that run while the menu is open, plus Mark as unread, Rename, Snooze until (with a submenu), Fork and Archive; the product more menu holds stop, discard, complete, reject, copy link and delete, without key hints.
- **Diff pane and commits**: the prototype thread shows an expandable Changes view with per-file add and delete lines and a Commits list (short sha in the review color, subject, `Cairn-Thread` trailer); the product shows word diffs in `detail/docpane.tsx` and has no commit list in the thread.
- **Plan list** (`detail/spec-block.tsx`): the prototype plan is a checklist with pending (dashed ring), now (spinning ring) and done (filled) steps; the product spec block renders the plan as Markdown on a secondary fill.
- **Work trace** (`detail/work-trace.tsx`): the prototype folds a finished turn into one line (`Read 9 files, ran 4 commands · 6m`) that expands to the command list; the product trace is a row list with per-step diff counts.
- **Toast with undo** (`components/ui/toaster.tsx`): the prototype toast is primary ink with a check, the text, an Undo button and a `⌘Z` hint, and `⌘Z` undoes while it is open; product `toastSuccess(title, action)` takes an action button in the default sonner style, bottom-left, with no `⌘Z` binding.
- **Project tile** (`board/project-avatar.tsx`): the prototype tile is a rounded square at 18px and 36px; `ProjectAvatar` uses the control radius (near-circular at 18px). The new gallery components pass a smaller radius instead of adding a parallel tile.
