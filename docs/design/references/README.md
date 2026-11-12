# Reference screenshot library

Real screenshots of reference products, captured 2026-11-06 by operating each product (D120). A UI brief names the surface, opens that folder first, and the PR shows our screen beside these shots (`.claude/skills/design-cairn/SKILL.md`). The rules that reference them are in `apps/web/DESIGN-RULES.md`.

Owner decisions on which product is the reference for each surface:

| Cairn surface | Reference product | Folder |
|---|---|---|
| Coordinator chat | Claude.ai | [coordinator-chat](coordinator-chat) |
| Thread list and sidebar | t3code and Amp | [thread-list-sidebar](thread-list-sidebar) |
| Settings | Amp and t3code | [settings](settings) |
| Thread progress, review and diff | t3code and Amp | [thread-review](thread-review) |
| First run and connection state | Amp (connection state sits on the composer) | [first-run](first-run) |
| Archived projects (Settings) | Claude.ai and Linear, captured 2026-11-09 | [archived-projects](archived-projects) |

Capture notes: Claude.ai and Amp were captured in the owner's signed-in Chrome. Early shots were read-only. Later the owner approved test messages: one test message was sent on Claude.ai (a chat titled `Basic arithmetic question` now exists in that account), and Claude.ai's theme was set to Light for two shots and restored to System. The Chrome window was about 454px wide, so the Claude.ai and Amp mobile shots are at that width (Chrome's window minimum is near 500px). t3code ran locally with scratch data and a scratch git repo. t3code ran locally from `npx t3@latest serve --host 127.0.0.1` with a scratch home, so it shows no account data. Personal details were painted over: the greeting name and the pinned chat in the Claude.ai sidebar, and a browser-extension bubble at the right edge of some shots. A grey block at the bottom left of the Claude.ai shots was a screenshot artifact and was painted with the sidebar color. Other shots are unedited.

## coordinator-chat (Claude.ai, dark, 1568px)

| File | State | What to compare |
|---|---|---|
| `claude-ai-empty-composer.jpg` | empty | Greeting, one composer, model and mode on the composer line, no other chrome |
| `claude-ai-streaming.jpg` | streaming, 1s | Sent message right-aligned and compact, reply starts directly under it, stop square in the composer |
| `claude-ai-reply-jump-to-latest.jpg` | long reply, 14s | Reply does not auto-scroll; a jump-to-latest arrow floats above the composer |

Mobile (454px wide window), added later:

| File | State | What to compare |
|---|---|---|
| `claude-ai-mobile-empty-light.jpg` | empty, light | Greeting, one composer card, model and mode under it; no sidebar, one icon top left |
| `claude-ai-mobile-error-toast-dark.jpg` | error, dark | A stale chat link opens a new chat and says in one toast (`That session is no longer available. Starting a new one.`) what happened and what was done |
| `claude-ai-mobile-loading-skeleton-light.jpg` | loading, light | Skeleton in the final shape of a message and a reply; the composer is already usable |
| `claude-ai-mobile-reply-actions-light.jpg` | reply done, light | Reply text with a row of small tools (copy, read aloud, rate, retry) directly under it; header has the title, a details button and Share |

Not captured: error inside a conversation (a failed send), and a long conversation on mobile.

Layout, status and task parts (Claude Duet desktop app, light, 1878px), added 2026-11-10 by owner decision: the Coordinator chat keeps Claude.ai as the reference for replies and the composer, and takes its shell layout, floating status mark, task references and right-hand panels from these shots. Frames come from a screen recording the owner made; the account name in the sidebar footer, the name in one greeting and one account handle in a reply were painted over.

| File | State | What to compare |
|---|---|---|
| `claude-duet-status-pill-typing.jpg` | reply pending | A round mark floats at the top centre with a status pill under it and the stream fades beneath it; three typing dots where the reply will land; message tools and the time beside a hovered message; a centred time divider between turns far apart |
| `claude-duet-sidebar-groups-undo-toast.jpg` | idle, after an archive | Sidebar with one main row, a group and its channels; three icon-only controls top right; a toast with Undo at the bottom right |
| `claude-duet-task-thread-working.jpg` | task running, thread open | The thread panel pushes the chat and folds the sidebar; header with a status line; a step list card with a spinner on the current step; `Show in main channel` under the quoted message; a task reference above the reply and inline in its text |
| `claude-duet-task-thread-ready-for-review.jpg` | task ready for review | Status line `Ready for review · 1 update`, a `Decisions and updates` block on top, every step ticked and one waiting on the user |
| `claude-duet-tasks-panel.jpg` | tasks panel | Tabs for active, up next, scheduled and resolved; rows with a checkbox and a row menu; an add control in the header |
| `claude-duet-channel-icon-picker.jpg` | icon picker | Icon and colour choice for a channel. Not adopted: sidebar rows stay neutral (L1, L3) |
| `claude-duet-composer-attachment.jpg` | file attached in the composer, remove hovered | A 122px tile at the top left of the composer card (name up to four lines, outlined kind pill, no size line), a round remove control on its corner and a dark tooltip that names the file; added 2026-11-11 from the second recording |
| `claude-duet-sent-attachment-uploading.jpg` | just sent, upload settling | The attachment is its own card above the user bubble, right-aligned with it; while the upload settles the card is a grey block with the name in a lighter ink |
| `claude-duet-file-preview-panel.jpg` | file open in the right-hand panel | The panel takes the side-panel slot and folds the sidebar; header with the file name, copy, download and close; the text in a light rounded box with a line-number gutter; an empty file shows a single line `1` |

Not captured: the sessions and work panels (the frames carried device and account names across most of the panel), dark theme, narrow widths.

## thread-list-sidebar (t3code and Amp)

| File | Product, state | What to compare |
|---|---|---|
| `t3code-empty-sidebar-new-thread.jpg` | t3code, no threads | `No threads yet`, one-line empty sidebar, project and git actions top right |
| `t3code-working-group-and-model-picker.jpg` | t3code, one thread working | Sidebar group `Working 1` above `Settled 0`; the row carries project, `Working 0s` and title; model picker open |
| `t3code-thread-row-after-reply.png` | t3code, reply done | Sidebar row is one card: project, `now`, title, provider glyph; the `Settled 0` group sits at the foot; model picker open over the composer |
| `t3code-mobile-sidebar-thread-row.png` | t3code, 390px | Sidebar as a full-height sheet, row with project, age (`1m`), title and provider glyph |
| `t3code-mobile-thread.png` | t3code, 390px | Reply with copy and branch tools and a time under it, composer with one model chip |
| `amp-sidebar-states-error-and-chronicle.jpg` | Amp, thread list | Rows with a state glyph, an `Error` tag, groups `Inactive Last 72h` and `Archived` |
| `amp-activity-filters-empty.jpg` | Amp, Activity, no threads | Filters (time, status, users, projects, sharing) and an empty-result message |

## settings (Amp and t3code)

| File | Product, page | What to compare |
|---|---|---|
| `t3code-general.jpg` | t3code, General | Modal with a left nav grouped by headings; one card per group; toggles on the right |
| `t3code-appearance.png` | t3code, Appearance | Color scheme and theme as visual choices, not a dropdown |
| `t3code-chat.png` | t3code, Chat | Short page, two groups, each setting a label plus one help line |
| `t3code-providers.png` | t3code, Providers | List on the left, detail on the right; status line says `Not authenticated` and the fix command |
| `t3code-threads.png` | t3code, Threads | Scope picker on top (`All projects` across `All environments`); defaults with unavailable choices stated |
| `t3code-environments-empty.png` | t3code, Environments | Empty state: icon, one sentence, one action |
| `t3code-mobile-settings.png` | t3code, 390px | Nav collapses to an icon rail beside the content |
| `amp-model-routing.jpg` | Amp, Model Routing | Wiring diagram from modes to providers; usage option as a radio pair |
| `amp-mode-dial-unavailable-reason.jpg` | Amp, mode picker | An unavailable choice is dashed and carries the reason (`Anthropic only allows Claude subscriptions in Claude Code`) |

## thread-review (t3code and Amp)

t3code shots come from a scratch repo with one real run (the agent added a function to one file); Amp shots are an existing thread at 454px.

| File | Product, state | What to compare |
|---|---|---|
| `t3code-working-thinking.png` | t3code, running | `Working for 0s` and `Thinking` as one quiet line; the stop control replaces send; the git panel on the right shows `+0 -0` |
| `t3code-done-changed-file-card.png` | t3code, done | The thread row in the sidebar (project, `now`, title, branch); `Worked for 13s` collapsed; the reply; one `1 changed file +4 -0` card with `Open diff` |
| `t3code-worked-expanded-with-diff.png` | t3code, worked section open beside a diff | Folded work shows narration and `Ran 1 command and changed 1 file`; the diff panel is a separate pane with scope (`Latest turn`), stacked or split toggle and green added lines |
| `t3code-diff-loading-skeleton.png` | t3code, diff loading | Skeleton rows in the shape of file headers and lines while the diff loads |
| `t3code-source-control-action-running.png` | t3code, commit started | The git block shows an inline spinner row (`Starting source control action...` with elapsed time) instead of a modal |
| `t3code-pull-requests-empty.png` | t3code, PR list | Empty state: sketch, one title, one sentence, `Check again`; search, sort and filters above |
| `amp-mobile-pending-question-running.jpg` | Amp, thread waiting on an answer | Numbered options with a keyboard digit each, `Other` with voice input, `Cancel` and `Select`; tabs `Agent`, `Changes`, `Portals`, `Files`, `Terminal` on top; the composer reads `Running Tools` with a stop button |
| `amp-mobile-changes-empty.jpg` | Amp, Changes tab | `No Changes` empty state in the review tab |

Not captured: a PR state with CI and a merged badge (t3code needs a GitHub remote and Amp's runs fail on authentication at the moment) and an Amp diff with real changes. Cursor's Agents UI (thread, `Worked` section, Changes panel with Diff, Review and Commits) was not added: the only available threads are the owner's private work, and a fresh Cursor run would start a cloud agent.

## first-run (Amp)

Amp does not use a wizard. The composer carries the state, and the screens below show the empty app, what is missing, and the way to fix it.

| File | State | What to compare |
|---|---|---|
| `amp-composer-orb-setup-banner.jpg` | new thread, nothing set up | Banner under the composer: what is missing, one primary action, `Docs`, `Dismiss` |
| `amp-run-location-chooser.jpg` | run-location chip open | Cloud default and `Connect a machine...` for local, in one small menu |
| `amp-composer-connect-a-machine.jpg` | no machine connected | The chip becomes `Connect a machine` with the exact command (`Run amp --no-tui to start creating threads`) beside it |
| `amp-orb-progress-and-error-toast.jpg` | run starting | Progress line in the thread (`Cloning into ...`); a title-generation failure is a dismissible toast that offers `Connection Settings`, not a blocking error |
| `amp-error-retry-connection-settings.jpg` | run failed on auth | Error card with `Retry`, `Retry from Last Message` and `Connection Settings`; the composer stays usable |

## archived-projects (Claude.ai and Linear, light, captured 2026-11-09, read-only)

| File | State | What to compare |
|---|---|---|
| `A01-claudeai-projects-archived-dimmed.png` | Projects page | Archived projects stay listed, dimmed, `· Archived` after the date |
| `A02-claudeai-archived-card-menu.png` | Card menu | `Unarchive` is one direct action, no confirmation |
| `A03-claudeai-archived-project-banner.png` | Archived project open | `Archived` chip after the name; a banner with `Unarchive` replaces the composer |
| `A04-claudeai-archived-project-menu.png` | Name menu | `Unarchive` in the project menu; conversation text blurred |
| `L01-linear-projects-show-closed.png` | Projects display options | Closed projects shown through `Show closed projects` |
| `L02-linear-settings-teams-retired-filter.png` | Settings > Teams | `Active` / `Retired` / `Recently deleted` filter on a settings list |
