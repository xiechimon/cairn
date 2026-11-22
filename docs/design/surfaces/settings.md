# Settings, forms and the models pages

The settings surface and the page patterns every settings-like page (resources, team, project) composes. A new page composes these pieces first and does not build its own cards, empty states, or forms inside the page. All pieces live in `src/components/`; all values go through tokens and the type steps.

## Rules

Scope: `apps/web/src/settings/` `apps/web/src/components/settings/` `apps/web/src/components/providers/` `apps/web/src/components/model-select-core` `apps/web/src/resources/` `apps/web/src/usage/` `apps/web/src/pages/` `apps/web/src/routes/account-page` `apps/web/src/routes/api-key` `apps/web/src/routes/im-page` `apps/web/src/routes/machine-authorize-page` `apps/web/src/routes/remote-access-page` `apps/web/src/routes/todo-redirect` `apps/web/src/routes/usage-page` `apps/web/e2e/settings-` `apps/web/e2e/provider` `apps/web/e2e/picker-filter` `apps/web/e2e/usage-` `apps/web/e2e/api-key` `apps/web/e2e/account-` `apps/web/e2e/skills-` `apps/web/e2e/skill-` `apps/web/e2e/secret-` `apps/web/e2e/vault` `apps/web/e2e/machine-authorize` `apps/web/e2e/storage-unavailable` `apps/web/e2e/theme-toggle` `apps/web/test/usage-` `apps/web/test/upstream-model-groups` `apps/web/test/computer-auth-scope` `apps/web/test/api-key` `apps/web/test/account-` `apps/web/test/settings-density` `apps/web/test/antigravity-subscriptions` `apps/web/test/bulk-secret-parse` `apps/web/test/access-identity`

| Id | Rule | Check |
|---|---|---|
| C20 | A model is named with its provider wherever it is picked or shown as the pick. | G `e2e/picker-filter.spec.ts` |
| C22 | A diagnostic action opens a small popover on click (spinner, what is checked) that switches in place to the result; no persistent check status, no reflow, no toast. | G `e2e/providers-subscription-verification.spec.ts`, `e2e/provider-test-connection.spec.ts`, `e2e/settings-mcp-recheck.spec.ts` |
| C30 | A settings nav entry earns its place with at least three rows of its own; a section with one or two controls joins the section they belong with as a titled group, and its old link redirects there. | M `test/settings-density.test.ts` |

## Settings list

Pieces: `src/components/settings-list.tsx`. The account page's "edit name" header is in `src/components/profile-card.tsx` (`ProfileHeader`, composing `SettingsHeader`).

- **Header above the card** (`SettingsHeader`): 56px white circular avatar (`line` 1px ring) + display title (`text-page` 500) + a `text-meta` `ink-3` description below; one optional action on the right (usually a text button). The name is not repeated as a row inside the card. For inline renaming, `editor` replaces the title, description, and action.
- **One card** (`SettingsCard`): white background, `line` 1px outer ring, `--radius-card`; rows carry no background color (no two-tone cards).
- **Row** (`SettingsRow`): minimum height 52px, 16px left and right; a `text-ui` `ink` label on the left (optionally with one `text-meta` `ink-3` description line), controls on the right. A section title or row label stands alone; the gray line appears only when the row's behavior or default cannot be read from the label and control, and it states that behavior or default, never a reason or a reassurance (`docs/research/settings-section-explanations-2026-11-20.md`). Rows with two-line content grow naturally. Custom rows that do not go through `SettingsRow` use `SETTINGS_ROW_CLS`.
- **Dividers are drawn only between rendered rows**: `divide-y` on the card, rows rendered conditionally, never hidden with CSS. A hidden row is still a sibling node and would draw a second border at the top of the card.
- **Controls are framed, one kind each**: dropdown = white background + `line` 1px ring + 8px radius + 32px tall (`SETTINGS_SELECT_TRIGGER_CLS`, the same string as the form's `FORM_CONTROL_CLS`); single-choice segmented = `SettingsSegmented` (i.e. `SegmentedRadio`, see "Segmented control" below); switch = `ToggleSwitch` (`components/toggle-switch.tsx`, never the bare registry `Switch`): a 36×20 track, a 16px neutral thumb inset 2px with a soft shadow (white in light; in dark the body ink when off and the card colour when on, so the ochre stays on the on track), `--switch-on` the ochre accent when on (claude.ai fills its switch with its accent, spec section 8) and `--switch-off` stone when off.
- **Danger zone** (`SettingsDangerZone`): a separate card at the very end of the page, one row: label + description on the left, a Button with `variant="destructive"` on the right, 32px with the standard 8px button corner. Clicking opens a confirm layer first; it never deletes directly.
- Do: header + one card + equal-height rows. Do not: a large avatar occupying a row, rows with background tints, a rounded-pill delete button, or danger actions mixed into ordinary settings cards.

## Forms

Piece: `src/components/form-layout.tsx` (the base is the registry `Field` family).

- **Stack** (`FormStack`): fields stacked vertically, 16px between fields, at most 520px wide, left-aligned.
- **Field** (`FormField`): label on top (`text-ui` 500 `ink`, `htmlFor` pointing at the control), the control, and an optional help line (`text-meta` `ink-3`) below.
- **Controls**: Input / SelectTrigger with `FORM_CONTROL_CLS`: 32px tall, white background, `line` 1px ring, 8px radius, `text-ui`.
- **Action row** (`FormActions`): the last row of the form, right-aligned; an optional text button (such as `取消`) on the left, the shadcn Button default primary on the right. When the form cannot submit, the button's own `disabled` state paints it `secondary` at 50% with the `--text-dim` label at full opacity, paler in fill and label than the grey `取消` pill beside it in both themes; every default (primary) Button disables this way, not only `DIALOG_PRIMARY_BUTTON`, so there is one disabled-primary look. In dark the half-strength `secondary` fill lands within a few levels of the dialog canvas, so a disabled primary there also carries the 1px `--border` hairline that keeps it reading as a button; fill and label stay as above. Other tiers fade to half strength. No separate gray bar.
- Do: a narrow column, labels on top, the primary button on the right. Do not: inputs spanning the whole column, full-width gray submit bars, or two-column forms with labels beside inputs.

## Segmented control

Piece: `src/components/segmented.tsx`. One appearance, two semantics:

- **`SegmentedTabs`**: switches views — each option controls a panel or a route (agent overview / memory / permissions, files | history, list | grid, team grid | org chart, provider runtime, branch dialog, Coordinator settings). The base is the registry `Tabs`, keeping `tablist` / `tab` semantics.
- **`SegmentedRadio`**: picks a value in a form or settings (appearance in the user menu, schedule frequency). `radiogroup` / `radio` semantics; arrow keys move and select, roving tabindex. Use it for "selecting a value that will be persisted"; use tabs for "which block to look at".
- **If it does not fit, switch to a dropdown**: when the option labels at 12px padding do not fit the column width, do not shrink the text and do not truncate — use the form Select instead (`SelectTrigger` + `FORM_CONTROL_CLS`). Example: the API protocol in the new-provider dialog (the three protocol names need about 460px; the dialog column is 416px wide).
- **Appearance**: track 32px tall, 2px inset, 8px radius, background `canvas` — one stone token; options 28px tall, 6px radius, 12px left/right padding for text options, and pure-icon options are 28px squares (must carry an `ariaLabel`). Unselected text is `ink`, the same as the selected option (as the reference), with no background tint and no ink change on hover; the selected option = white background (`card`) + `line` 1px ring + one extremely light shadow, text 500 `ink`. The accent is not used. Disabled items use the primitive's own translucency.
- **Focus**: mouse clicks show no ring. Keyboard `:focus-visible` is a 2px `--focus-ring` ring, **inset** inside the option box (`outline-offset: -2px`, the `[data-segmented="option"]` rule in `styles/app.css`): options are only 2px apart, and an outer ring would press onto the neighbor.
- **Sliding**: `slide` makes the white tab slide between options on a 150ms underlying pill (only Coordinator settings uses it, #644).
- Do: assemble every segmented control from these two pieces; e2e handles attach via `className` (track) and `optionHandle` (option). Do not: hand-write `role="radiogroup"` / `role="tab"`, or restyle `TabsList` / `TabsTrigger` directly in a page — `scripts/ui-drift-gate.mjs` G7 will block it.

## Grouped selector

The grouped selector (providers): a search box on top, then groups under small headings (`text-caption` 500 `ink-3`); each row is 40px = a 22px first-letter tile (white background + `line` ring) + name + an `ink-3` tag on the right (OAuth / not yet enabled). Hover and keyboard focus = the selector's selected row (white card + hairline ring). Disabled rows drop the text to `ink-3` and show no hover. Search filters across groups and whole empty groups hide; "Other · custom endpoint" is always there.

## Model routing

**RoutingGraph / QuotaRow** (`settings/`): the two-column model-routing graph. Job nodes are two rows (name in the job's project ink, then "Model" and the mono model id) with a 1px border in the job's project tile at 55%; each connects by a 1.5px curve in the job's ink to its connection node, which shows name, plan tier and `QuotaRow` bars (5h, week) showing how much is left, ochre at 20% left and below. Unavailable nodes are dashed in destructive at 45% with a small Unavailable tag and no curve.

## Diagnostic action result (C22)

An explicit diagnostic action (Verify on a subscription, a model's test button, Test all, Reconnect on a failing MCP connector and the re-verification after saving its URL or key) never reflows the page: nothing is inserted under its row. The click opens a small popover anchored to that button at once, with a spinner and one sentence saying what is being checked; the button only disables, and nothing else on the page (button label, model chips, the models count) shows progress (direction 1 of the prototype). When the check finishes the same popover switches in place to one plain sentence saying whether it connected and what to do if not (C5), then a monospace line with what ran, its result and its age. A click outside or Esc closes it. It never holds a credential, a status code or raw upstream output. There is no persistent check status: no `未验证`, `可用`, `验证失败` or `登录失效` beside the button, on a model chip or in a provider row's subtitle, and a stored last check stays server-side, unshown until the user runs a check. Account states the server reports (cooling, quota used up, expired) and failures met elsewhere, such as a step failing on an expired login, keep their own patterns. No toast repeats the result. Reference: `components/ui/popover.tsx`, `resources/provider-editors.tsx` (`CheckResultPopover`).

## No inert UI (C25)

A control with no real choice (a selector whose options resolve to fewer than two different settings) or a label that only says something cannot be done is not rendered; the slot stays empty. Build it into the component: the thinking selector (`apps/web/src/resources/thinking-level-select.tsx`) returns nothing below two real choices, so no caller can render a dead control.

## Rows fill their card (V30)

A row of controls or fields spans its card: a sibling row that fills the width forbids a blank region of 40% or more at either end of another row. A one-line sentence row is exempt. The measure spec checks it over the fixture surfaces (`e2e/design-rules-measure.spec.ts`, blank region beside content). The Claude subscription detail is the pinned case: the head keeps the name block and the quota on one row (the name block shrinks and truncates instead of pushing the quota down), the Name input takes the detail row's width with the Connection block sized to its content, and a subscription carrying neither a rename nor a verify action shows only its status line.

## Pickers of models and user data (C19, C20)

- A picker of user data (models, tasks, branches, projects, machines, MCP servers) that can hold more than 10 options filters as you type. The field is hidden until the first printable key on the open menu, appears at the top holding that key, and hides again when Backspace or Esc empties it; the menu footer reads `输入可筛选` and the count. The query matches each option's name and its secondary label (a model's provider and runtime, a task's project); space-separated words must all match, and `-`, `.` and spaces are ignored. While filtering, groups flatten, each row carries its secondary label in `ink-3` and the matched part in bold; the arrows skip disabled rows, Enter picks, the first Escape clears and the second closes, and no match is one sentence that repeats the query. Under `pointer: coarse` the field is always shown, because there is no key to type. Action menus with key letters never filter. Build it from `components/filter-picker.tsx`.
- A model is named with its provider wherever it is picked or shown as the pick. With no filter the menu groups models under each provider's name and a row shows the model alone; a filtered row and the trigger show the model, then the provider in `ink-3`. When space runs out, the provider truncates before the model.
