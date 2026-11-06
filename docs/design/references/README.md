# Reference screenshot library

Real screenshots of reference products, captured 2026-11-06 by operating each product (D120). A UI brief names the surface, opens that folder first, and the PR shows our screen beside these shots (`.claude/skills/design-cairn/SKILL.md`). The rules that reference them are in `apps/web/DESIGN-RULES.md`.

Owner decisions on which product is the reference for each surface:

| Cairn surface | Reference product | Folder |
|---|---|---|
| Coordinator chat | Claude.ai | [coordinator-chat](coordinator-chat) |
| Thread list and sidebar | t3code and Amp | [thread-list-sidebar](thread-list-sidebar) |
| Settings | Amp and t3code | [settings](settings) |
| First run and connection state | Amp (connection state sits on the composer) | [first-run](first-run) |

Thread and review has no reference folder yet; use the thread shots in `thread-list-sidebar` until the owner picks one.

Capture notes: Claude.ai and Amp were captured read-only in the owner's signed-in Chrome (nothing sent, nothing started; Amp's composer chips were opened and closed). t3code ran locally from `npx t3@latest serve --host 127.0.0.1` with a scratch home, so it shows no account data. Personal details were painted over: the greeting name and the pinned chat in the Claude.ai sidebar, and a browser-extension bubble at the right edge of some shots. A grey block at the bottom left of the Claude.ai shots was a screenshot artifact and was painted with the sidebar color. Other shots are unedited.

## coordinator-chat (Claude.ai, dark, 1568px)

| File | State | What to compare |
|---|---|---|
| `claude-ai-empty-composer.jpg` | empty | Greeting, one composer, model and mode on the composer line, no other chrome |
| `claude-ai-streaming.jpg` | streaming, 1s | Sent message right-aligned and compact, reply starts directly under it, stop square in the composer |
| `claude-ai-reply-jump-to-latest.jpg` | long reply, 14s | Reply does not auto-scroll; a jump-to-latest arrow floats above the composer |

Not yet captured: error, mobile and light theme. Capturing them means sending a message or resizing the owner's browser, which needs the owner's go-ahead.

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

## first-run (Amp)

Amp does not use a wizard. The composer carries the state, and the screens below show the empty app, what is missing, and the way to fix it.

| File | State | What to compare |
|---|---|---|
| `amp-composer-orb-setup-banner.jpg` | new thread, nothing set up | Banner under the composer: what is missing, one primary action, `Docs`, `Dismiss` |
| `amp-run-location-chooser.jpg` | run-location chip open | Cloud default and `Connect a machine...` for local, in one small menu |
| `amp-composer-connect-a-machine.jpg` | no machine connected | The chip becomes `Connect a machine` with the exact command (`Run amp --no-tui to start creating threads`) beside it |
| `amp-orb-progress-and-error-toast.jpg` | run starting | Progress line in the thread (`Cloning into ...`); a title-generation failure is a dismissible toast that offers `Connection Settings`, not a blocking error |
| `amp-error-retry-connection-settings.jpg` | run failed on auth | Error card with `Retry`, `Retry from Last Message` and `Connection Settings`; the composer stays usable |
