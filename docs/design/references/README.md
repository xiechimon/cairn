# Reference screenshot library

Real screenshots of reference products, captured by operating each product (`walk`). `apps/web/DESIGN.md` (`## Surfaces`) maps each Cairn surface to its folder below; `.claude/skills/design-cairn/SKILL.md` defines the reference-versus-ours acceptance workflow.

Capture notes: Claude.ai and Amp shots come from the owner's signed-in Chrome (mobile shots ~454px wide); t3code shots come from a local scratch instance; personal handles and extension artifacts were masked out.

## coordinator-chat (Claude.ai & Claude Duet)

| File | State | What to compare |
|---|---|---|
| `claude-ai-empty-composer.jpg` | empty | Greeting, one composer, model and mode on the composer line, no other chrome |
| `claude-ai-streaming.jpg` | streaming, 1s | Sent message right-aligned and compact, reply starts directly under it, stop square in the composer |
| `claude-ai-reply-jump-to-latest.jpg` | long reply, 14s | Reply does not auto-scroll; a jump-to-latest arrow floats above the composer |
| `claude-ai-mobile-empty-light.jpg` | 454px empty, light | Greeting, one composer card, model and mode under it; no sidebar, one icon top left |
| `claude-ai-mobile-error-toast-dark.jpg` | 454px error, dark | Stale chat link opens a new chat and states in one toast what happened and what was done |
| `claude-ai-mobile-loading-skeleton-light.jpg` | 454px loading, light | Skeleton in the final shape of a message and a reply; the composer is already usable |
| `claude-ai-mobile-reply-actions-light.jpg` | 454px reply done, light | Reply text with small tools directly under it; header has title, details and Share |
| `claude-duet-status-pill-typing.jpg` | reply pending | Round mark top centre with status pill, fade beneath, three typing dots, hover meta beside message, centred time divider |
| `claude-duet-sidebar-groups-undo-toast.jpg` | idle, after archive | Sidebar with main row, group and channels; three icon-only controls top right; bottom-right Undo toast |
| `claude-duet-task-thread-working.jpg` | task running, thread open | Thread panel pushes chat and folds sidebar; status header, step list card with spinner, `Show in main channel`, task references |
| `claude-duet-task-thread-ready-for-review.jpg` | task ready for review | Status line `Ready for review · 1 update`, `Decisions and updates` block on top, ticked steps and one waiting on user |
| `claude-duet-tasks-panel.jpg` | tasks panel | Tabs for active, up next, scheduled and resolved; rows with checkbox and row menu; add control in header |
| `claude-duet-channel-icon-picker.jpg` | icon picker | Icon and colour choice for a channel (not adopted: sidebar rows stay neutral per L1, L3) |
| `claude-duet-composer-attachment.jpg` | file attached in composer | 122px tile top left of composer card (up to 4-line name, kind pill), corner remove button with dark tooltip |
| `claude-duet-sent-attachment-uploading.jpg` | just sent, upload settling | Attachment card right-aligned above user bubble; grey block with lighter ink while uploading |
| `claude-duet-file-preview-panel.jpg` | file open in side panel | Panel takes side-panel slot and folds sidebar; header with name, copy, download, close; light rounded code box with gutter |

## thread-list-sidebar (t3code and Amp)

| File | Product, state | What to compare |
|---|---|---|
| `t3code-empty-sidebar-new-thread.jpg` | t3code, no threads | `No threads yet`, one-line empty sidebar, project and git actions top right |
| `t3code-working-group-and-model-picker.jpg` | t3code, one thread working | Sidebar group `Working 1` above `Settled 0`; row carries project, `Working 0s` and title; model picker open |
| `t3code-thread-row-after-reply.png` | t3code, reply done | Sidebar row card: project, `now`, title, provider glyph; `Settled 0` at foot; model picker over composer |
| `t3code-mobile-sidebar-thread-row.png` | t3code, 390px | Sidebar as full-height sheet, row with project, age (`1m`), title and provider glyph |
| `t3code-mobile-thread.png` | t3code, 390px | Reply with copy and branch tools and time under it, composer with one model chip |
| `amp-sidebar-states-error-and-chronicle.jpg` | Amp, thread list | Rows with state glyph, `Error` tag, groups `Inactive Last 72h` and `Archived` |
| `amp-activity-filters-empty.jpg` | Amp, Activity, no threads | Filters (time, status, users, projects, sharing) and empty-result message |

## settings (Amp and t3code)

| File | Product, page | What to compare |
|---|---|---|
| `t3code-general.jpg` | t3code, General | Modal with left nav grouped by headings; one card per group; toggles on the right |
| `t3code-appearance.png` | t3code, Appearance | Color scheme and theme as visual choices, not a dropdown |
| `t3code-chat.png` | t3code, Chat | Short page, two groups, each setting a label |
| `t3code-providers.png` | t3code, Providers | List on left, detail on right; status line says `Not authenticated` and fix command |
| `t3code-threads.png` | t3code, Threads | Scope picker on top (`All projects` across `All environments`); defaults with unavailable choices stated |
| `t3code-environments-empty.png` | t3code, Environments | Empty state: icon, one sentence, one action |
| `t3code-mobile-settings.png` | t3code, 390px | Nav collapses to an icon rail beside content |
| `amp-model-routing.jpg` | Amp, Model Routing | Wiring diagram from modes to providers; usage option as a radio pair |
| `amp-mode-dial-unavailable-reason.jpg` | Amp, mode picker | Unavailable choice is dashed and carries the reason |

## thread-review (t3code and Amp)

| File | Product, state | What to compare |
|---|---|---|
| `t3code-working-thinking.png` | t3code, running | `Working for 0s` and `Thinking` as one quiet line; stop replaces send; git panel `+0 -0` |
| `t3code-done-changed-file-card.png` | t3code, done | Sidebar row; `Worked for 13s` collapsed; reply; `1 changed file +4 -0` card with `Open diff` |
| `t3code-worked-expanded-with-diff.png` | t3code, worked + diff | Folded work shows narration and `Ran 1 command and changed 1 file`; diff pane with scope, stacked/split toggle, green lines |
| `t3code-diff-loading-skeleton.png` | t3code, diff loading | Skeleton rows in shape of file headers and lines while diff loads |
| `t3code-source-control-action-running.png` | t3code, commit started | Git block shows inline spinner row (`Starting source control action...` + elapsed time) instead of a modal |
| `t3code-pull-requests-empty.png` | t3code, PR list | Empty state: sketch, one title, one sentence, `Check again`; search, sort and filters above |
| `amp-mobile-pending-question-running.jpg` | Amp, pending answer | Numbered options with keyboard digits, `Other` with voice, `Cancel` and `Select`; composer `Running Tools` + stop |
| `amp-mobile-changes-empty.jpg` | Amp, Changes tab | `No Changes` empty state in the review tab |

## first-run (Amp; Cairn two-step departure)

Cairn ships as the desktop app (which starts the local Runner), so a team with no projects gets a two-step setup page (connect models, confirm Coordinator model) before its first project; afterwards the composer chip carries connection state as in Amp.

| File | State | What to compare |
|---|---|---|
| `amp-composer-orb-setup-banner.jpg` | new thread, nothing set up | Banner under composer: what is missing, one primary action, `Docs`, `Dismiss` |
| `amp-run-location-chooser.jpg` | run-location chip open | Cloud default and `Connect a machine...` for local, in one small menu |
| `amp-composer-connect-a-machine.jpg` | no machine connected | Chip becomes `Connect a machine` with exact command beside it |
| `amp-orb-progress-and-error-toast.jpg` | run starting | Progress line in thread; title-generation failure is a dismissible toast offering `Connection Settings` |
| `amp-error-retry-connection-settings.jpg` | run failed on auth | Error card with `Retry`, `Retry from Last Message` and `Connection Settings`; composer stays usable |

## archived-projects (Claude.ai and Linear)

| File | State | What to compare |
|---|---|---|
| `A01-claudeai-projects-archived-dimmed.png` | Projects page | Archived projects stay listed, dimmed, `· Archived` after the date |
| `A02-claudeai-archived-card-menu.png` | Card menu | `Unarchive` is one direct action, no confirmation |
| `A03-claudeai-archived-project-banner.png` | Archived project open | `Archived` chip after name; banner with `Unarchive` replaces composer |
| `A04-claudeai-archived-project-menu.png` | Name menu | `Unarchive` in project menu; conversation text blurred |
| `L01-linear-projects-show-closed.png` | Projects display options | Closed projects shown through `Show closed projects` |
| `L02-linear-settings-teams-retired-filter.png` | Settings > Teams | `Active` / `Retired` / `Recently deleted` filter on a settings list |
