# Web UI audit — 2026-11-28

A whole-tree scan of `apps/web/src` against `apps/web/DESIGN.md` (the which-component table) and `docs/design/surfaces/foundation.md`. It looks for screens that render ad-hoc UI instead of the shared components:

- inline instructions
- hand-rolled dialogs
- links or bare buttons used as actions
- raw server text
- other which-component violations

Paths are relative to `apps/web/src`. The Slice column says where each row is handled:

- **this change**: fixed with the shared sign-in view and the toast change (`docs/design/sign-in-view-and-toasts.md`)
- **follow-up N**: fixed in a follow-up commit of the same lane, one commit per class
- **conforms**: checked against the rule and left as it is, with the reason

These were checked and are not findings:

- Screens already on `DialogShell`: `computer-screen-dialog.tsx`, `search-panel.tsx`, `token-gate.tsx`.
- The `deliberate-native` file input in `composer-surface.tsx`.
- The resize handle in `side-panel.tsx`.
- Raw text shown only in a tooltip or a details disclosure, which C5 allows: `desktop-update.tsx`, `account-page.tsx`, `machine-authorize-page.tsx`, `first-run-provider-check.tsx`, `first-run-setup.tsx`, `turn-failure.tsx`.
- Pairing and confirm codes on a dedicated view with no sign-in URL: the pairing banner, the token gate, the remote-access request card, `machine-authorize-page.tsx`.

The gate added by this change, `scripts/ui-guidelines-gate.mjs` C5, keeps classes 1 and 4 from coming back. Specifically, it fails on:

- inline `userCode` or `verificationUri` outside the shared sign-in view
- a direct `sonner` import
- `describeError(...)` or `.message` passed into a toast
- a mutation with no `meta.action`

## Classes

1. Inline sign-in or device code instead of the shared sign-in view.
2. A hand-rolled dialog instead of `DialogShell` or `Confirm`.
3. A link or bare `<button>` used as an action instead of `Button`.
4. Raw server text in a toast or an in-surface error line (C5).
5. Other which-component rows: a divider drawn with `border-t` or `w-px` instead of `Separator`, an empty state written by hand instead of `Empty`, a homemade floating surface instead of `Popover` or `DropdownMenu`, a hand-rolled switch.

## Table

| File | What | Rule | Slice |
|---|---|---|---|
| resources/create-provider-dialog.tsx | ChatGPT device code and URL as one bare line under the search box; xAI the same | which-component: sign-in view; C5 | this change |
| resources/add-provider-flow.tsx:247 | sign-in error line from `describeError` (server text) | C5 | this change (replaced by the view's own failure copy) |
| resources/devin-subscriptions.tsx | waiting row built by hand | sign-in view | this change |
| resources/antigravity-subscriptions.tsx | three waiting rows built by hand | sign-in view | this change |
| resources/claude-subscriptions.tsx | `claude setup-token` buried in a sentence | sign-in view | this change |
| routes/remote-access-page.tsx:348 | Tailscale login QR plus open and copy link inline in a settings card; no waiting state or cancel | sign-in view | follow-up 1 |
| chief/selection-reply.tsx:238 | `role="dialog"` quote box portalled by hand with its own Esc and outside-click handling | Dialog / Popover | follow-up 2 |
| board/first-run-provider-check.tsx:185 | "Undo this import" as a link button inside the import card | V6 | conforms: V6 makes card actions text links |
| chief/takeover-card.tsx:164 | "Turn on push" as a link button inside the takeover card | V6 | conforms: card action |
| detail/source-issue.tsx:56 | "Retry" as a link button inside the issue card | V6 | conforms: card action |
| pages/project-new-page.tsx:437 | "Disconnect" as a link button on the connected-account line | V6 | conforms: card action |
| detail/attachment-chip.tsx:68 | `<a href>` whose click opens the in-app preview | A7 | conforms: a real link to the file, so the context menu can open or copy it; a plain click opens the in-app preview |
| routes/usage-page.tsx:431 | heatmap day cells as `Button variant="link" size="icon"` | Button | follow-up 3 |
| overlay/search-panel.tsx:410 | bare `<button>` with its own classes for the remove-context × | Button (icon) | follow-up 3 |
| components/ui/toaster.tsx:14 | `toastError` always put server text in the body (root of every toast) | C5 | this change |
| resources/providers-page.tsx:526 | toast title = `describeError(err)` | C5 | this change |
| chief/announce-unsent.ts:21 | toast body = `describeError` | C5 | this change |
| board/task-delivery.ts:59 | outbox error line from `describeError` (server text) | C5 | follow-up 4 |
| board/thread-automations.tsx:203 | schedule error line from `describeError` | C5 | follow-up 4 |
| board/use-thread-chat.ts:573 | steer send error from `describeError` | C5 | follow-up 4 |
| pages/dir-browser.tsx:324 | folder load error line from `describeError` | C5 | follow-up 4 |
| pages/project-new-page.tsx:203 | folder-pick hint = `err.message` | C5 | follow-up 4 |
| pages/project-new-page.tsx:275 | local-path error falls back to `createError.message` | C5 | follow-up 4 |
| resources/phones-panel.tsx:296 | raw `lastError` in the phone status row | C5 | follow-up 4 |
| resources/skill-dialog.tsx:183 | error detail = `err.message` | C5 | follow-up 4 |
| resources/skill-dialog.tsx:245 | error detail = `err.message` (second form) | C5 | follow-up 4 |
| resources/skill-import-dialog.tsx:49 | `ErrorLine` detail = `err.message` | C5 | follow-up 4 |
| schedules/schedule-popover.tsx:278 | schedule error from `describeError` | C5 | follow-up 4 |
| schedules/schedule-popover.tsx:316 | save error from `describeError` | C5 | follow-up 4 |
| board/artifact/artifact-toolbar.tsx:17 | hand-made `w-px` vertical divider | Separator | follow-up 5 |
| board/tasks-panel.tsx:208 | hand-made `w-px` dock divider (also :223) | Separator | follow-up 5 |
| board/first-run-provider-check.tsx:159 | `border-t` list divider | Separator | follow-up 5 |
| board/made-files.tsx:181 | `border-t` between file rows | Separator | follow-up 5 |
| board/sidebar.tsx:518 | `border-t` above the archived section | Separator | follow-up 5 |
| board/side-chat.tsx:472 | `border-t` row dividers | Separator | follow-up 5 |
| chief/context-meter-ring.tsx:455 | `border-t` section dividers (also :478) | Separator | follow-up 5 |
| chief/memory-panel.tsx:229 | `border-t` section dividers (also :285, :323) | Separator | follow-up 5 |
| components/notice-banner.tsx:67 | `border-t` before the actions row | Separator | follow-up 5 |
| components/settings-list.tsx:93 | flat-card variant drawn with `border-t` | Separator | follow-up 5 |
| components/settings/routing-graph.tsx:170 | `border-t` row dividers | Separator | follow-up 5 |
| detail/transcript.tsx:75 | `border-t` between transcript sections | Separator | follow-up 5 |
| pages/dir-browser.tsx:201 | `border-t` divider (also :383) | Separator | follow-up 5 |
| pages/project-settings-page.tsx:79 | `border-t` between sections | Separator | follow-up 5 |
| resources/create-machine-dialog.tsx:472 | `border-t` section divider | Separator | follow-up 5 |
| resources/desktop-host-panel.tsx:236 | `border-t` divider inside the card | Separator | follow-up 5 |
| resources/machine-row.tsx:347 | `border-t` divider inside a row | Separator | follow-up 5 |
| resources/own-computer-panel.tsx:164 | `border-t` divider inside the card | Separator | follow-up 5 |
| resources/provider-editors.tsx:288 | `border-t` above the details grid | Separator | follow-up 5 |
| resources/upstream-model-picker.tsx:513 | `border-t` section divider | Separator | follow-up 5 |
| routes/usage-page.tsx:524 | `border-t` row divider | Separator | follow-up 5 |
| search/query-chip.tsx:111 | `border-t` above the hint | Separator | follow-up 5 |
| board/design/design-comment-list.tsx:338 | "No comments yet" written by hand | Empty / C12 | follow-up 6 |
| board/route-override-dialog.tsx:234 | "No MCP servers yet" written by hand | Empty | follow-up 6 |
| board/sidebar.tsx:538 | "No archived projects" written by hand | Empty | follow-up 6 |
| board/work-panel.tsx:179 | "No archived work yet" written by hand | Empty | follow-up 6 |
| components/settings/settings-search.tsx:184 | "No matching settings" written by hand | Empty | follow-up 6 |
| detail/docpane.tsx:283 | "No plan yet" written by hand | Empty | follow-up 6 |
| pages/dir-browser.tsx:197 | "No recent folders" written by hand | Empty | follow-up 6 |
| resources/frequent-models-card.tsx:213 | "No frequent models yet" written by hand | Empty | follow-up 6 |
| resources/skill-import-dialog.tsx:304 | "no skills / no match" written by hand | Empty | follow-up 6 |
| resources/skills-page.tsx:145 | "No matching skills" written by hand | Empty | follow-up 6 |
| resources/vault-page.tsx:268 | "No approved sites yet" written by hand | Empty | follow-up 6 |
| routes/im-page.tsx:292 | "No registered machines yet" written by hand | Empty | follow-up 6 |
| routes/remote-access-page.tsx:408 | "No paired devices yet" written by hand | Empty | follow-up 6 |
| runs/run-turns-popover.tsx:136 | "No turns yet" written by hand | Empty | follow-up 6 |
| board/artifact/file-comments.tsx:431 | comment composer placed by hand from `getBoundingClientRect` | Popover (anchored floating surface) | follow-up 7 |
| chief/selection-reply.tsx:298 | quote toolbar placed by hand from a Range rect | Popover (anchored floating surface) | follow-up 7 |
| components/settings/settings-search.tsx:179 | homemade absolute `listbox` results panel | Popover (anchored floating surface) | follow-up 7 |
| overlay/mention-inline.tsx:38 | homemade absolute mention listbox | Popover (anchored floating surface) | follow-up 7 |
| runs/run-turns-popover.tsx:265 | homemade absolute hint bubble | Tooltip / Popover | follow-up 7 |
| tray/tray-page.tsx:349 | `Button role="switch"` tile instead of `Switch` | Switch | follow-up 7 |
