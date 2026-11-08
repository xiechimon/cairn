# Android installed web app: backend and worker design

Date: 2026-11-08
Status: Proposed implementation contract; no routes or migrations shipped

Requirement: [#3475](https://github.com/xiechimon/cairn/issues/3475). Read the claim-tagged [research](../research/android-installed-web-app-2026-11-08.md) and [frontend design](android-installed-web-app-frontend.md) first. The feature-registry row remains planned. Separately dispatch tests-first implementation only after the real-component drafts and owner selection required by the UI brief.

## Plan and decisions

| Question | Recommendation and basis | State |
| --- | --- | --- |
| Which application? | Existing installed web app; no native Android package, new MCP surface or desktop shell | Scope from request |
| Who supplies the phone? | The owner executes the acceptance checklist after implementation | Confirmed in task conversation |
| Category scope | Per authenticated user, team and push subscription; not a browser-local switch that the server ignores | Proposed |
| Completion default | Off; explicit opt-in extends #2598 without restoring unsolicited completion traffic | Proposed |
| Reply action | Navigate to the exact authorized question; portable inline text reply is not part of the platform contract | Documented platform boundary |
| Share offline model | Worker-local bounded inbox and a small static review shell; upload/submit only after authenticated confirmation | Proposed |

Overlap plan: 1. Extend existing #3475. 2. Keep #3476 and desktop #136 independent. 3. Integrate #3485's answer lifecycle rather than duplicate it. 4. Consume merged #3462/#3148/#2713, preserve #2598's quiet default and cite #3424's main IA only. 5. Initial production-path open-PR overlaps were empty. Documentation paths overlap #3486 (`cairn/conv-01a1bc77-10b5-7dec-b021-4fe865bf6370`, registry/maps) and #3473 (`feat/chat-markdown-polish`, generated skill map); proceed additively and regenerate after merging main. Full intent comparison is in the research note. Repeat lookup against the actual implementation file list before building and before PR creation.

## Data and API contract

Extend each `push_subscription` row with non-null booleans `needs_answer` default true and `completed` default false. Existing rows receive those defaults. Preserve endpoint ownership, paired-device association, revocation and the existing maximum-subscriptions rule. A resubscription/key refresh must preserve category choices; it must not reset them through an upsert.

Proposed authenticated endpoints in the existing `/api/teams/:id/push/**` family:

| Operation | Input | Success | Rejection |
| --- | --- | --- | --- |
| `POST .../subscriptions/preferences/read` | `{endpoint}` | `200 {needsAnswer, completed}` | 404 for absent or foreign-owned endpoint |
| `PATCH .../subscriptions/preferences` | `{endpoint, needsAnswer, completed}` | `200 {needsAnswer, completed}` after committed update | 400 for invalid/unknown fields; 404 for absent or foreign-owned endpoint |

The endpoint is passed in a JSON body to avoid query/history leakage. Use the same allowlisted push-host validation and request limiting as subscription registration. Authorization checks authenticated user, team and active paired device. A read cannot transfer ownership or return encryption keys. Only the caller's exact subscription is updated; a team-wide preference must not be inferred from a local push permission.

`PushMessage` gains an explicit category and an optional discriminated question target, not a category inferred from a title/tag. The target contains request id plus either Coordinator thread id or task/build identity. Server construction verifies the relationship. Completion messages have no question target. Legacy messages without a category retain existing behavior during rollout; newly produced attention/completion messages must use explicit categories, tested at every producer.

Inventory every producer of `pushToUserSafely`, `sendPushToUser`, `queuePushDigest` and must-reach alerts before changing filtering. Operational must-reach alerts retain their existing delivery/escalation contract; do not label an intentionally suppressed category as provider failure and trigger email escalation. A suppressed ordinary message has a distinct internal outcome and does not create a failed-delivery receipt expectation.

Filter subscriptions on the server before sending a category. Worker-only suppression would still send content to disabled devices and could conflict with user-visible push expectations. Keep in-app notifications and the needs-you count independent of push choices.

## Event and dedupe rules

- Questions and decisions use `needs-answer`; task done uses `completed` only for devices opted in at send time.
- Preserve archived/snoozed suppression and active-thread presence rules. Completion push does not wake or resume a task.
- Completion emission is bound to one real transition into done, not a repeated phase setter, polling read, merged-PR reconciliation or historical row scan. Use existing transactional phase machinery to establish the event identity; a retry uses the same identity. Re-entry after real new work is a new event.
- Include category in the notification tag along with stable entity identity. Two categories for one thread must not replace each other. A question tag includes request id so separate questions remain distinguishable. A tag is not an OS grouping guarantee.
- Old subscription defaults remain quiet. Opting in sends future completion events only; opting out never changes the task's underlying completed state.

## Launch intents and answering

Use internal URL intents, validated at both worker and page boundaries. Proposed shapes:

| Intent | URL | Consumption |
| --- | --- | --- |
| New task | `/app?launch=new-task` | Existing create/Coordinator intent; preserve typed draft; remove launch parameter once handled |
| Needs you | `/app?launch=needs-you` | Existing authoritative attention surface, all projects; remove parameter after handling |
| Coordinator question | `/app?launch=answer&chief=<thread>&question=<request>` | Fetch authorized question and open that card |
| Task question | `/app?launch=answer&todo=<todo>&build=<build>&question=<request>` | Verify current build relationship; open its exact card |

Do not accept arbitrary redirect parameters, protocol-relative URLs or external origins. Query ids are identifiers only, never tokens or answer text. Unknown actions fall back to the safe stored body-click destination. Missing/malformed targets land in a non-mutating unavailable state, not a random newest question.

The worker supplies a single Answer action only for a valid question target. Avoid depending on newer action-level navigate support: handle `event.action` with the existing stored-navigation/postMessage mechanism. Keep notification body tap equivalent. Preserve cold-start, warm-start and suspended-client behavior. Consume pending intent after authentication and successful target resolution, not merely after receiving a message; a reload must not lose a login-gated target. Same-document URL changes while a worker message is in flight require an intent identity to prevent duplicate processing.

Question submission remains the existing authenticated page route. Coordinate with #3485 on request-id matching, duplicate-click prevention, already-answered state, local draft cleanup and count invalidation. No worker answer POST or new token cache is needed.

## Share target and durable local inbox

Proposed manifest entry: action `/app/share-target`, method POST, enctype multipart/form-data, params for title/text/url and a files array using exactly the MIME/extension allowlist the attachment service accepts. Keep manifest id, scope and start_url stable. A plain bookmark install may not register this target; report that as an installation/platform limitation, not a successful receipt.

The worker fetch handler intercepts only same-origin POST to that exact path and the versioned static share-review shell/assets. All API, ordinary navigation and existing authentication behavior stay network-controlled. This intentionally changes the current no-fetch-handler design only for a requirement that needs offline intake; do not introduce broad authenticated response caching.

Receive sequence:

1. Validate content type and bounded body before unbounded multipart parsing. Limit text to 64 KiB UTF-8, at most 10 files, and total request size to the existing attachment per-file limit plus a small bounded form overhead. Count bytes, not JavaScript string length. Reject excess with a visible local error; no silent truncation. Verify actual available request-stream APIs in the installed worker test environment before implementing the bound.
2. Normalize title/text/url as strings without executing HTML or fetching URLs. Preserve URL-in-text. Validate files with the shared attachment size/type policy and show a per-file refusal; never invent an extension-based permission bypass.
3. Commit one IndexedDB transaction containing the local share id, timestamp, raw fields and supported blobs. Use a random local id and a maximum of 10 retained shares. If full, show an inbox-full state with explicit discard choice; do not silently evict unsent work. Expire retained content after seven days with clear UI wording. Clearing browser data or uninstalling can remove local drafts.
4. Redirect with 303 to a versioned cached local review shell and opaque local id only. No raw share content in a URL, server log, push payload or analytics event. Cache only static public shell resources; do not cache tokens, session replies, conversation data or authenticated API responses.
5. The local review shell reads that exact draft. It makes no authenticated upload or server draft write until the session is validated and a destination is explicitly confirmed. A share captured while signed out stays unassigned until then.
6. On confirmed staging, reuse existing attachment grants and the normal create/Coordinator path. Preserve a pre-existing composer draft separately. Persist transfer status so refresh/back does not duplicate attachments or task creation. On accepted creation, remove only the consumed local share. Unknown network outcome is shown for reconciliation; do not blind-retry a task-creation POST.

Worker activation must not claim offline reception readiness until the versioned static shell has actually been cached. If installation caching fails, online reception may remain usable but cold-offline receipt must show failure, not a promise of saved work. Storage denial/quota exhaustion rejects the intake visibly and offers recoverable text; it cannot guarantee survival after the process closes.

Local content is accessible to this browser profile, not isolated by server account. Logout clears authenticated state and hides account-bound drafts. An unassigned incoming share is shown only through explicit review. Switching account/team never uploads or transfers it automatically.

## Tests first and smallest implementation sequence

Before production changes, add failing tests against current behavior, one mechanism at a time. Do not commit permanently red tests as a passing implementation.

| Layer | Required failure before implementation | Required pass after |
| --- | --- | --- |
| Shared schemas | Category/target union and preference body absent | Strict fields, invalid ids, malformed targets and byte bounds rejected |
| Server DB/routes | Independent subscription preferences absent | Defaults migrated; endpoint/user/team/device isolation; re-register preserves preferences |
| Push service | Both categories currently indistinguishable | Every producer explicitly classified; category combinations; suppressed outcome never escalates; no disabled-device payload |
| Phase fan-out | Done never produces opt-in completion | Default remains silent; opt-in sends once; snooze/archive/presence and real re-entry tested |
| Worker harness | No actions/share handler | Body/action equivalence; origin validation; cold/warm/suspended clients; stale/unknown action; receipt behavior unchanged |
| Local inbox | No durable intake | Cold-offline read; denied/full storage; multipart and byte/file limits; same-account explicit transfer; no overwrite or duplicate create |
| Web e2e | No URL intents or share review | Sign-in return, resolved question, failed answer retains draft, pending count from #3485, offline submit disabled, shortcuts consumed once |
| Device | Not run by automation | Owner verifies installed WebAPK launcher, share chooser, OS notification actions and limitations |

Run only the affected tests locally, plus required lint/typecheck/spec parsing and prepush. Full suites and current-head cloud review belong to CI. Verify the compiled worker or runtime event log, not just source text. PR evidence separates mocked push transport, real server behavior and owner-run Android results.

Rollback: subscription defaults and category fields are additive, but already-enabled completion recipients need a clear revert plan. Remove the new manifest targets and stop new producers first; retain recoverable unsent local share data until the owner can discard/export it. Do not delete other sessions' drafts or reset existing subscriptions as cleanup.
