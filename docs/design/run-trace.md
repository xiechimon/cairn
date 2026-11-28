# Conversation and task trajectory — plan, 2026-11-28

## User scenario

A newcomer opens the Coordinator after sending a message, or opens a task they asked it to do. Beside Conversation, `Trace` answers what happened, which step is running or failed, and what the model and tools returned. No new account, key, payment, or setting: the existing signed-in team reads its own server records. Missing history stays visibly missing; a disconnected runner does not hide history. Why: in the selected prototype, an automatic wake showed internal provenance, generic tool labels, duplicate notification, and missing model/usage. The former dialog took the user away from the conversation. Owner, 11-28 (translated): "use direction 1 for the trace, and I want to know whether a task can enter this trace too. Should it share one page? It should share one page; do not maintain that many components; follow our design rules." This supersedes the dialog design. [Prototype and reference observations](../research/run-trajectory-2026-11-28.md).

| Situation | What the user sees | What the system does | Wait and cost |
|---|---|---|---|
| Open Trace from either header | Same ledger and inspector across Coordinator and task; existing conversation can be restored with one press | Scope existing list/detail queries to the selected conversation or task | One page and one selected run; no new model call |
| Switch General or a project | Problem count per conversation; independent ordered runs under each | Navigate the existing conversation shell; fetch the selected ledger, counts from the team list response, not inferred from one page | Bounded page requests |
| Find a wake or failure | Sent/wake and problems controls; search the conversation's loaded trace summaries; first failed step when opening a linked problem | Filter ledger, keep selection by stable id, inspect overview, input, output and timing | No per-step request |
| Watch a run or open it later | New steps arrive; manual selection stays put; brief status settles in place | Reuse current team query invalidation, with bounded active revalidation if live events do not cover trace writes | Read only while visible; no runner or provider calls |
| Inspect large output | Scroll within the selected payload; existing redacted JSON export has full text | Cap each inline value at the existing limit and the detail response's combined payload previews at 128 KiB, pacing active refresh; export on explicit request | No payload fetch per step |
| Open older history or use an older runner | Real recorded model and usage where available; no value inferred from text or cumulative counters | Readers accept pre-change records; model-call rows are recorded only when an authoritative provider message is available | No migration or backfill |

## Scope

1. Direction 1: use the Cairn navigation shell (General and each project conversation, with actual problem counts), chronological expandable turn summaries, input/model/tool timing lanes, and a selected step's inspector. Show only a meaningful field with data; no fabricated time, tokens or model. At narrow widths use one pane and a Back control. The filters and search stay within their conversation; no new dashboard.
2. One `RunTrace` list/detail family, one React trajectory view for both surfaces. `TraceGroup`/`TraceRows` own reusable row, disclosure and grouping presentation through `components/chat/trace-parts.tsx`. `WorkTrace` owns the compact transcript summary and existing narration/background presentation; the full ledger composes the same row family, never a parallel generic trace primitive. Existing conversation content, composer, PR/diff, retry and task actions are unchanged.
3. Delete `apps/web/src/runs/run-page.tsx`, its old list and any exclusively used dialog/hint controls. Move status mark, task `⋯`/T, More menu and failure/stopped links to the tab, preserve existing run bookmarks as redirects (only the shared view renders), preserve JSON download and team scope. Browser back and tab changes restore the correct conversation/task, including direct links and a missing run. Update feature map, tests and living design docs rather than keeping two descriptions.
4. Extend the existing run read model additively (High review: REST response plus capture semantics, no migration required). Use real tool identity and correlate only reliable call ids or explicit producer duplicates; retain genuinely repeated calls. Resolve wakes to human-readable event kind, not raw prompt/provenance, including exports/list labels. Capture provider-reported name, input/output usage and available start/end per model call using existing message/telemetry channels; turn totals use existing accounting once, not a sum of cumulative stream updates. Historical missing provider metrics are explicitly unavailable. Keep task sub-engine steps under their parent with tool ids disambiguated by engine/session. Existing authentication, redaction, full export, ordering, and server-side scoping remain in force.
5. Capture production versus fixture evidence separately. Production browser gate: token-authenticated `/api/auth/session` must return 204 before any page opens. Natural-language verification, no approvals or owner questions; leave messages in storage and archive only projects created for verification via UI. No use of the installed desktop profile. Record running-to-settled live and verify deployed ancestry after preflight/queue.

### Slices and contract

- A — projection and REST schema: `packages/shared/src/run-trace.ts` declares `todo` (exclusive with `thread`), optional `includeCounts`, additive `problemCounts: {threadId,count}[]`, `wake` item with machine-readable reason, `model` item (id, model, input/output/cache usage or null, start and end when recorded), and `parentId` on tool items. List/build selection applies the existing team/visible-project checks plus exact `todo`; counts use the Coordinator-list visibility and failed/stopped/quota predicate across all pages, only on the first requested page, grouped once by visible Coordinator thread. They do not scan task builds. One indexed chief-step scan plus the existing error classification lookup, O(visible chief turns), replaces client fan-out. No database column or migration. `routes-runs.ts` writes these REST responses; `run-trace-api.ts` and JSON export consume them. Detail enforces the existing team check and visible thread boundary, including bookmarked hidden infrastructure conversations. Existing `inspect_run` keeps its independent reader and output; its turn accounting uses the same unchanged `chiefTurnUsage` source, not derived call rows.
- B — capture: native `entryRowSources` writes one tagged assistant metadata row per completed provider message, with stable entry id shared by live mirror and input replay; runner `step-pass-events.ts` writes the same metadata through existing transcript upsert at `message_end` using the provider message's reported usage rather than delta totals. Use the existing assistant row-content channel; exclude metadata from both conversation prose and native seed context, and use recorder wall time separately from known provider call timing. `RunTrace.usage` remains canonical accounting from `chiefTurnUsage` or `token_usage`; `step.ranModel` is a fallback name, not a source of usage. On write failure the existing transcript replay/retry owns recovery; old runners without reported per-call data remain readable. Runtime-specific adapters translate to a shared metadata shape once, so renderers never need backend switches.
- `services/chief.ts` retains raw wake metadata for provenance validation; `services/run-trace.ts` uses its reason internally to label list/detail/export and never exports the raw wake prompt. For same-id tool updates keep a useful name over generic titles, otherwise prefer a newer explicit tool name. The observed wake's `使用 mcp__acp_…__notify_user` transport wrapper overlaps `cairn / notify_user`; collapse only provider-wrapper/server duplicates with matching identity or a uniquely matching overlapping invocation and equal payload. Two real calls remain separate, including identical args. ACP informational actions with no real tool identity must not masquerade as tool calls; do not invent names. Preserve `call.parent` in task trace items; absent parents stay at root, distinct run/call ids do not collide.
- C — new `apps/web/src/runs/run-trace.tsx` and existing Coordinator/task mounts; replace the old e2e and add a targeted Vitest trace model/selection test for the inversion gate (Playwright is separate). App routing reads `trace`/`run`/`step` query state; tab, shared ledger, and existing conversation navigation write it. Switching scope clears run and step in the same navigation; selection is verified against the current task/Coordinator thread before rendering. Stale step id falls back to the run's default; legacy authorized route redirects without rendering another UI, hidden/missing target enters the shared not-found state. Existing `App.tsx`, `chief-conversation.tsx`, `chief-message-rows.tsx`, `chief-status-mark.tsx`, `turn-failure.tsx`, task actions, More menu, `ui-consumer-registry.json`, `visual-surfaces.json` and verify feature map all migrate. The old dialog design (`docs/design/run-log-window.md`, deleted in this change) is retired, and its names are retired in `scripts/doc-retired-terms.json` without banning legacy bookmark strings needed for compatibility.
- Live reads: cache by team and scope/run; on foreground trace refresh active detail and the first list page, stop scheduled detail refresh on terminal response, hidden tab, unmount or 10 minutes of inactivity; no background polling. Revalidate on focus/reopen and existing live invalidations. Pace active detail as steps grow (2s small, 8s for 100+ items); use a response ETag and conditional revalidation to avoid resending unchanged payloads while retaining `no-store`. Apply 128 KiB per-detail combined preview budget after redaction, with explicit omitted/truncated data and unchanged full download. Render detail rows in batches of 100; timeline and first failure remain reachable. Localize the header(s) with the active Cairn locale, using `Intl.DateTimeFormat` calendar order and 24-hour time, not browser-default US date.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Empty conversation and task, zero/one/mixed sub-engines | No unrelated run; same tab/empty text; child calls only for known parents | `apps/web/e2e/run-trace.spec.ts` — empty traces; `apps/server/test/run-trace.test.ts` — exact todo list and child parents | this change |
| Running turn, two clients, switches mid-fetch, rapid picks, settles success/failure | Stable selected id and scroll when another client appends; scoped stale response ignored; stops polling on terminal state | `apps/web/e2e/run-trace.spec.ts` — updates the selected running turn without resetting | this change |
| Failed or recovered tool, quota-held, waiting/retry, stopped | Notice opens trace tab; error selectable; existing task/Coordinator status and retry remain separate | `apps/web/e2e/run-trace.spec.ts` — opens linked failures and retains recovered steps | this change |
| Long CJK/unbroken output, 200+ steps, export fails | Bounded batches and inner scroll; truncation indicator; export full or toast, no additional clipboard feature | `apps/web/e2e/run-trace.spec.ts` — bounds the long ledger and exports; `apps/server/test/run-trace.test.ts` — byte budget, conditional read and full export | this change |
| Offline runner, 400ms network, 401/403/5xx, stale paging cursor, question pending | Cached history stays; scoped retry or auth guidance, restart paging after invalid cursor, question stays in Conversation | `apps/web/e2e/run-trace.spec.ts` — keeps history offline and recovers list errors | this change |
| 390px/dark/reduced motion, keyboard and screen reader | Semantic focusable tabs and row controls, one pane, Back, no overflow or forced motion | `apps/web/e2e/run-trace.spec.ts` — narrow inspector is keyboard reachable | this change |
| Authorized old bookmark, wrong team, hidden or archived/deleted run; stale step | Redirect to correct tab; stale step resets within run; removed selection shows scoped not-found; no cross-team metadata | `apps/web/e2e/run-trace.spec.ts` — resolves old bookmarks into tabs; `apps/server/test/run-trace.test.ts` — scoped lists, hidden infrastructure and wrong-team detail | this change |
| Wake prefix, named ACP call/status update, projected relay and genuinely repeated tools | Labeled wake, real names, one row per invocation | `apps/server/test/run-trace.test.ts` — projects a wake with a correlated relay and distinct repeats | this change |
| Two model calls with mixed zero/nonzero/unreported usage; duplicate delivery; legacy rows | Per-call usage where recorded, aggregate equals canonical total once, no reconstructed usage | `apps/server/test/run-trace.test.ts` — projects authoritative calls without deriving accounting | this change |
| Localized header date, counts beyond first page including settled status changes | Date follows active locale, full group counts independent of filters and paging | `apps/web/test/run-trace-model.test.ts` — locale format and rejects foreign selection; `apps/server/test/run-trace.test.ts` — counts beyond page without task or hidden rows | this change |

Red on parent: new or rewritten e2e assertions require tab semantics and inspector selectors; the Vitest files assert missing/incorrect production behavior rather than unchanged authorization and cap alone. Fixtures use a wake prompt with provenance, overlapping wrapper/real MCP calls plus repeated direct calls, child call ids in two parents, mixed assistant usage plus canonical accounting, and enough settled visible turns to put problems on an older page. Production auth/recording are delivery evidence, not inversion proofs.

## UI brief

Surface: Coordinator chat and thread/review. Goal: one shared page next to conversation, direction 1. Draft: owner-selected direction 1, `run-log-trace/prototype/prototype.html` and `opt1-{user,wake,failed}.png`. Reference captures inspected: `references/coordinator-chat/claude-ai-mobile-reply-actions-light.jpg` (existing narrow chrome), `references/thread-review/t3code-worked-expanded-with-diff.png` (compact transcript plus inspector), DeepSeek `ref-deepseek-1-trajectory-ledger.png` and `ref-deepseek-2-tool-inspector.png` (main ledger and inspection); Langfuse span tree only for parentage. Compare on the real stack at 1440 and 390, light and dark.

| Component | empty | loading | error | offline | slow network | rapid repeated input | long content | pending question | 390px | dark | transition |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Tabs and conversation groups | fixture with no runs | real shell and seeded pending counts | seeded counts fetch failure | live/fixture cached shell | fixture +400ms | e2e alternating 50ms | fixture long CJK project/title | verify stack only | fixture and live | fixture and live | tab and back without shell remount |
| Shared ledger and inspector | empty fixture | delayed same-shape skeleton | seeded failed tool, denied and retry | fixture runner offline | fixture +400ms | e2e keyboard/touch and rapid selection | fixture 200+ steps and large values | verify stack existing question, no extra card | fixture and live | fixture and live | record appear/update/settle/reopen live |
| Transcript WorkTrace, unchanged | no work group | existing skeleton | seeded failed tool | cached work | fixture +400ms | repeated disclosure | long tool fixture | existing question | verify fixture | verify fixture | verify no regressions to existing work growth |

Craft: Arrival — existing rows do not remount; new rows appear without autoscroll; honor reduced motion (C23/A2/V24). States — warm caches show immediately, delay skeleton ~200ms in ledger shape; user selections are immediate (A4/C34/C35). Finish — tabular counts/timing, Cairn base/card dark surfaces, optical glyphs (V27–29), localized date. Measure — visual-baseline for P7, run-trace spec for narrow width, no offset jump, delayed/loading and selection; existing foundation measures for glyph/color. Compare screenshots per reference/state; report worse differences and uncovered cells, inspect the full diff and all old entry callers.

Rules: `node scripts/design-rules-for.mjs apps/web/src/board/home-c.tsx apps/web/src/board/side-chat.tsx apps/web/src/chief/chief-status-mark.tsx apps/web/src/detail/work-trace.tsx apps/web/src/components/chat/trace-parts.tsx apps/web/src/runs/run-trace.tsx`, especially P1–P7, C5/C12/C13/C14/C23/C34/C35, C26/C32, V1/V4/V10/V27–V29, T1/T2/T6, A1–A4/A7–A9, R1 and V24. Conversation and tasks surface trace sections govern ownership above.

<details>
<summary>Applicable design rules (tool output)</summary>

97 design rules apply to: apps/web/src/board/home-c.tsx, apps/web/src/board/side-chat.tsx, apps/web/src/chief/chief-status-mark.tsx, apps/web/src/detail/work-trace.tsx, apps/web/src/components/chat/trace-parts.tsx, apps/web/src/components/chat/trace-steps.tsx, apps/web/src/runs/run-trace.tsx

apps/web/DESIGN.md:
| Id | Rule | Check |
|---|---|---|
| P1 | Start from a reference: name the surface, open its shots in `docs/design/references/<surface>/` before code; the wrap-up shows a reference-versus-ours row per state. | H |
| P2 | A feature touching a main surface (first run, Coordinator chat, thread list and sidebar, thread and review, settings) needs a page draft before code; backend-only and single-setting changes exempt. | H |
| P3 | List component x state before coding: empty, loading, error, offline, slow network, rapid repeated input, long content, pending question, 390px, dark, transition; seed what the stack cannot produce. | H |
| P4 | Drafts and fixtures use real copy and real-looking data, never lorem ipsum or `Item 1`. | H |
| P5 | Fixture screenshots (`?scenario=`) are labelled as fixture evidence and never stand in for the live stack. | H |
| P6 | Before code, the brief answers the design-cairn craft questions: what grows, which states, which finishing rules, which spec measures each answer. | H |
| P7 | Accept visual changes by real rendered pixels (before/after screenshots and `e2e/visual-baseline.spec.ts`), never by computed styles or source reading alone. | M `e2e/visual-baseline.spec.ts`; G `visual-baseline-gate`; H |

docs/design/surfaces/chrome.md:
| Id | Rule | Check |
|---|---|---|
| C48 | Desktop submenus use `DropdownMenuSub` with open/close hover delay and a pointer safe triangle so diagonal travel to the submenu does not dismiss it. | H; G `test/menu-keys-source.test.ts` |

docs/design/surfaces/conversation.md:
| Id | Rule | Check |
|---|---|---|
| C8 | Show connection and agent state where the user acts, on the composer line, not only on a settings page. | H |
| C11 | A pending choice question or approval is one non-collapsible card where it was asked: the question in the reply serif, numbered rows with descriptions, the first tagged `推荐` and never preselected, an Other input and Skip; later messages land below it. A question without options is a plain Coordinator bubble. | G `e2e/chief-inline-cards.spec.ts`, `e2e/chief-home-questions.spec.ts`, `e2e/chief-home-tray.spec.ts`, `e2e/chief-thread-report.spec.ts`, `e2e/info-card-report.spec.ts`, `test/question-card.test.ts` |
| C33 | A question card means the Coordinator stopped and waits; suggested replies are only its guess at your next line, faint pills under the last reply that send on click and hide once you type. Never both: while a question is pending, the suggested replies are hidden. | G `e2e/chief-quick-replies.spec.ts` |
| C13 | Below 640px the Coordinator home floats three controls at the top: menu, the status mark, and the `任务` button with its count badge. | G `e2e/chief-home-narrow-shell.spec.ts` |
| C14 | The task thread panel is the conversation, not a dashboard: head, transcript, composer; no stepper, dashboard card or extra footer between them. | G `e2e/chief-home-thread-panel.spec.ts`, `e2e/chief-home-side-chat.spec.ts`, `e2e/chief-home-thread-usage.spec.ts`, `e2e/info-card-report.spec.ts` |
| C26 | The Coordinator chat renders only messages, cards, exception alerts and status alerts; tool calls and their traces stay in the stored tool-call rows, except `show_diff` and `show_chart`, whose result is part of the reply. A row kind not classified in `CHIEF_ROW_CLASS` does not render. | G `test/chief-mac-activity.test.ts`, `tsc` exhaustiveness of `src/chief/chief-row-kinds.ts` |
| C16 | A message carries no agent label; an agent mention in an old message is its name in plain text. | G `e2e/agent-identity-chip.spec.ts`, `test/segments-mention-nav.test.ts` |
| C17 | Historical daily reports render read-only; no buttons and no new reports are generated. | G `e2e/chief-daily-report.spec.ts` |
| C31 | Both sides are one `MessageBubble` in the sans at the owner's size: the owner's message on the sand `--bubble-fill`, a Coordinator reply on the grey `--reply-bubble-fill`; no serif remains in the conversation; tables, code blocks, chips and cards inside a reply keep their own faces. | M `e2e/chief-reply-bubbles.spec.ts` (C31 test) |
| C18 | After sending, the user's message and the reply's start are in the viewport; a jump-to-latest control appears after scrolling away. | M `e2e/chief-home-follow-send.spec.ts` |
| C32 | A failed, waiting-to-retry, parked or quota-held step or turn in any conversation (Coordinator chat, task transcript) is one `components/chat/notice-line.tsx` `NoticeLine` (a separator in transcripts, `plain` in the docked card): icon, a short plain reason (with the retry time), and `详情` opening the guidance and raw error; no file draws its own status row or typing dots. | G `test/notice-line-reuse.test.ts` |
| C46 | A reply table sizes each cell to its text up to 16rem and wraps only past 16rem without breaking short words mid-word; a table wider than its bubble scrolls sideways inside the bubble, and the page does not. | M `e2e/chief-reply-bubbles.spec.ts` (C46 tests) |

docs/design/surfaces/foundation.md:
| Id | Rule | Check |
|---|---|---|
| C1 | One fact, one wording: a status comes from one selector and is not restated differently elsewhere on the page. | M text of one entity is identical across header, list and footer |
| C2 | No capability, no placeholder: never render a block for a feature that is not available; one line says what is off and the action to enable it. | M `e2e/design-rules-guidelines.spec.ts`: no element text matching `^[\s—·-]+$`; no empty fixed-ratio block |
| C3 | Secondary controls reveal on hover, focus or proximity and take zero layout space when hidden (reachable via press menu or visible trigger on touch/`<=640px`); hover meta sits outside its bubble without shifting or covering text. | M `e2e/chief-message-toolbar.spec.ts` (C3), `e2e/chief-reply-actions-overlap.spec.ts` |
| C4 | Every icon-only control has a visible tooltip and an accessible name. | M `e2e/a11y-axe-sweep.spec.ts`: hover shows a tooltip and icon buttons carry an accessible name |
| C5 | No raw error text reaches the user: map it to a plain sentence saying what to do next; raw text lives in a tooltip or details. | M `test/ui-guidelines-static.test.ts`: toast literals never match `\(.*\)$`, `Error:`, `\b[45]\d\d\b` |
| C6 | Developer switches (feature flags, release buttons) never sit on a user page; they live behind the dev route or dev mode. | H |
| C7 | A disabled control says why next to it. | M `e2e/design-rules-guidelines.spec.ts`: disabled composer send control sits beside explanatory prompt context |
| C12 | An empty state is one sentence and at most one primary action. | G `ui-page-style-gate` |
| C15 | A task is named by its title wherever a person reads it; no composer trigger, picker or inserted token names a task by its sequence number. | G `e2e/chief-thread-report.spec.ts`, `e2e/chief-stream-markdown.spec.ts`, `e2e/composer-inline-mention.spec.ts`, `e2e/chief-composer-tools.spec.ts`, `test/segments-mention-nav.test.ts` |
| C19 | A user-data picker with more than 10 options filters as you type; build it from `components/filter-picker.tsx`. | G `e2e/picker-filter.spec.ts` |
| C21 | A picker of something invisible (sound, haptics, timing) lets the user experience the real artifact in place, never a description alone. | H |
| C23 | What the user already sees stays put while a live surface updates: no remount and no offset change until it settles. | G `e2e/chief-live-stability.spec.ts` |
| C24 | A change the user makes shows in the same frame; a failure puts the row back and says so. | M `e2e/chief-home-tasks-panel.spec.ts` (Mark done lands / fails) |
| C25 | No inert UI: a control offering fewer than two real choices, or a label that only says something cannot be done, is not rendered. | M `e2e/settings-routing.spec.ts` (C25 test) |
| C27 | An action on a whole document or dialog (copy, download, view source) is an icon-only ghost button with a tooltip in the dialog head beside close (`DialogShell` `headerAction`), never a text button under the title; it confirms in place. | M `e2e/chief-thread-report.spec.ts` |
| C28 | A secret shown once (a new API key, token or enrollment code) appears in a modal whose only close is an explicit "I saved it" action, with the full value, a copy button and a line saying it cannot be viewed again; the list row behind it shows only the masked form from the start, never the value inline. | M `e2e/api-key-grants.spec.ts` |
| C29 | A resizable edge stays a 1px hairline at rest and at most 2px on hover or drag, while its invisible hit zone is 24px wide, lying outside the panel except for the panel's own 4px padding, so the pointer grabs it without hunting and no panel control loses its click. | M `e2e/chief-home-thread-panel.spec.ts` |
| C34 | Transient status, hints, validation and loading text appear inside an existing element (chip, row, button state), a reserved fixed-height slot, or an overlay (tooltip, popover, toast); they never insert into the flow and move content below (CLS = 0, stricter than Core Web Vitals). | M `e2e/no-layout-shift.spec.ts` (C34) |
| C35 | Core Web Vitals INP: every press, click and keypress paints its visible answer (or pending state under slow network) within 200 ms, with p98 PerformanceObserver event duration at most 200 ms. | M `e2e/web-vitals-perf.spec.ts` (C35) |
| C36 | INP typing diagnostic: typing in the Coordinator composer or the add-task row never blocks the main thread, with PerformanceObserver longtask entries reporting zero tasks over 50 ms. | M `e2e/web-vitals-perf.spec.ts` (C36) |
| C37 | Core Web Vitals loading and stability per surface: opening main surfaces and switching threads paints LCP within 2.5 s and keeps load CLS at most 0.1 on the fixture stack, while measuring and reporting FCP and TTFB. | M `e2e/web-vitals-perf.spec.ts` (C37) |
| V1 | Colors, sizes, radii and shadows come from tokens; no hex, no arbitrary pixel values. | G `ui-drift-gate`, `ui-debt-gate` |
| V2 | Fonts are Source Serif 4, Instrument Sans and JetBrains Mono only. | M `e2e/design-rules-measure.spec.ts`: computed `font-family` of every text node is in the set (CJK fallbacks allowed) |
| V3 | No gradients, neon glows, heavy shadows, gradient text, frosted blur panels, decorative blobs or emoji as icons or labels. | M `test/anti-slop-foundations.test.ts`, `test/unslop-signs.test.ts` |
| V4 | No box-in-box, nested cards or extra dividers: a list is rows in one divided `ListCard`, group with space instead of lines; one card corner per page. | M `e2e/design-rules-measure.spec.ts`: nested `[data-slot=card]` count is 0; G `ui-drift-gate` G9 |
| V5 | ~90% neutral surfaces and ink; one accent (ochre) for waiting-on-you, focus ring, enabled send and on-switch, plus green running dot and rust failure (exceptions: task tint, count badge, PR state, chart series). | G `ui-drift-gate`, `test/anti-slop-foundations.test.ts`; H |
| V6 | One primary action per screen, the `primary` Button; card actions are text links; sibling settings actions share `outline`. | M `e2e/design-rules-measure.spec.ts`: at most one filled `primary` outside dialog footers on each main surface; `e2e/settings-routing.spec.ts` |
| V7 | Elevation is `--e1`, `--e1-lift`, `--e2` or `--e3` only; no second ring, no raw `box-shadow`. | G `ui-drift-gate` |
| V8 | Spacing stays on the 4px grid (4/8/12/16/24 steps via tokens and Tailwind scale; arbitrary pixel spacing only shrinks). | G `ui-debt-gate`; H |
| V9 | Icons are lucide from the project icon set; never invent an icon name. | G `pnpm typecheck` |
| V10 | Pages compose existing pieces before building their own. | G `ui-page-style-gate`, `ui-drift-gate` |
| V11 | A project carries no colour: its chosen icon or a name-derived neutral glyph; only a person's `SeededAvatar` may be a tinted letter. | M; G `test/anti-slop-foundations.test.ts`, `test/avatar-tint.test.ts`, `e2e/avatar-initial.spec.ts` |
| V12 | At most 2 non-neutral hue families per screen beyond the V5 roles (decoded avatars, provider marks, user content and the V11 tint excluded). Syntax highlighting in code views is exempt: its muted `--code-token-*` palette is mixed from Cairn tokens toward the foreground. | M; `e2e/design-rules-guidelines.spec.ts` |
| V13 | Type budget: sizes from the token steps, at most 6 per screen; at most 3 font weights; at most 9 size and weight pairs. | M; `e2e/design-rules-guidelines.spec.ts` |
| V14 | Icon uniformity: lucide stroke 1.75, sizes 16, 20 or 22px by role. | M; G `test/icon-stroke.test.ts` |
| V15 | Badge budget: at most 3 tinted short-text elements per screen (keycaps excluded); the task glyph tile and chip are not counted. | M; `e2e/design-rules-guidelines.spec.ts` |
| V16 | No texture or gradient on surfaces; ink grain only on the brand spiral and the filled-button specks. | M; G `test/anti-slop-foundations.test.ts` |
| V17 | A speaker is not repeated: consecutive messages from one speaker show at most one avatar per speaker change. | M; `e2e/design-rules-guidelines.spec.ts` |
| V18 | Like rows fold: three or more sibling rows with the same status sit under one section heading. | M; `e2e/design-rules-guidelines.spec.ts` |
| V19 | A placeholder is not content: no text node consists only of `—`, `·` or `-`. | M; G `e2e/design-rules-measure.spec.ts` |
| V20 | An object list is rows in one card, not a grid of identical cards; the results panel's preview row is the exception. | M; G `e2e/design-rules-measure.spec.ts`: no grid or stack of three or more outlined 12px-corner cards outside the results panel |
| V21 | No hover shadows or elevation; a hover background covers the whole row or control. | G `ui-drift-gate` G8 |
| V22 | Sentence case and normal tracking: no uppercase labels; `letter-spacing` normal on every text node. | M; G `test/unslop-signs.test.ts` |
| V23 | No weight of 800 or more and no italic in chrome; emphasis is weight or ink step. | M; G `test/unslop-signs.test.ts` |
| V25 | Text keeps the platform's default font smoothing: no `-webkit-font-smoothing` or `antialiased` utilities. | G `test/font-smoothing.test.ts` |
| V27 | Every count, time and figure renders in tabular figures. | M `e2e/texture-tabular-figures.spec.ts` |
| V28 | Dark layers separate by surface lightness, not stroke; an outlined group fills with `card` in dark. | M `test/dark-text-tertiary-contrast.test.ts` |
| V29 | A status glyph sits on the optical centre of its box. | M `e2e/texture-glyph-alignment.spec.ts` |
| V30 | A row of controls or fields fills its card: no blank region of 40% of a row's width at one side while a sibling spans full width; one-line sentences exempt. | M `e2e/design-rules-measure.spec.ts`: blank region beside content |
| T1 | One language per screen: UI strings go through `t()`, no English inside Chinese labels; use the `CONTEXT.md` glossary term for thread, task and agent. | M `test/ui-guidelines-static.test.ts`; G `test/unslop-signs.test.ts`: no unapproved Latin word inside CJK strings |
| T2 | Copy says what happened and what to do, in the user's words; errors say how to fix, empty states what is missing. | H |
| T3 | No text node contains a backtick; code renders as `<code>`. | M; G `e2e/design-rules-measure.spec.ts` |
| T4 | Copy is plain: no exclamation mark, emoji or hype word in UI strings; a one-sentence title ends without a period; visible copy states what is, never why (no `因为`, `所以`, `because`); a reason or background sentence goes behind an `InfoTip` (the `info` prop on `SettingsSection`, `SettingsRow`, `IntegrationRow` or `DialogShell`), shown on hover and focus. | M; G `test/unslop-signs.test.ts` |
| T5 | One word per state and one name per concept: copy uses the status words and the register of `CONTEXT.md` (`## Status words`, `## Copy register`) — neutral written Chinese, no spoken softeners, no English contractions. | M; G `test/unslop-signs.test.ts` reads the Avoid columns |
| A1 | Click targets are at least 24px on desktop and 44px on touch. | M hit area, also under `pointer: coarse`; `e2e/design-rules-measure.spec.ts` measures the Tasks panel checkbox |
| A2 | Keyboard focus is visible (`--focus-ring`); `prefers-reduced-motion` respected; animate only `opacity` and `transform` except the named Growth utilities. | M `test/ui-guidelines-static.test.ts`: no unguarded `outline-none` and `prefers-reduced-motion` present |
| A3 | axe reports 0 violations at `wcag2a/aa/21aa/22aa` in light and dark. | M `e2e/a11y-axe.spec.ts` |
| A4 | Loading shows nothing for 150 to 300ms, then a skeleton in the final shape whose rows sit at the loaded tops. | M Tasks and Made: `tops()` of the skeleton rows equal the loaded rows' in `e2e/chief-home-tasks-panel.spec.ts`; other panels H |
| R1 | Every state in P3 is checked at 1440px and 390px, light and dark; no horizontal scroll at 390. | M `e2e/design-rules-measure.spec.ts`: `scrollWidth <= innerWidth` at 390px |
| A7 | Interactive controls use semantic `<button>`, `<a>` or native controls rather than clickable `<div>`/`<span>` or bare `<select>`. | M `test/ui-guidelines-static.test.ts`: zero clickable `div`/`span` and bare `<select>` |
| C38 | Controls use `touch-action: manipulation`; overlays set `overscroll-behavior: contain`; edge `overscroll-behavior: none` stays in `@media (pointer: fine)`. | M `test/ui-guidelines-static.test.ts` checks `src/styles/app.css` |
| C39 | Images provide an explicit `alt` attribute (`alt=""` when decorative) and suppress drag on interactive links (`-webkit-user-drag: none`). | M `test/ui-guidelines-static.test.ts` checks `<img>` props and `src/styles/app.css` |
| C40 | Non-input controls set `user-select: none`; headings set `text-wrap: balance` and scroll margin; text selection and a quoted span's mark (`::highlight(cairn-quote)`) are the ochre `--card-button` at 32%, never the neutral `--accent`, which equals the reply bubble fill. | M `test/ui-guidelines-static.test.ts` checks `src/styles/app.css`; `e2e/chief-selection-quote.spec.ts` (C40) measures the painted mark on a reply bubble |
| C41 | Email, URL and password inputs set `spellCheck={false}` to suppress browser red underlines on addresses and secrets. | M `test/ui-guidelines-static.test.ts` checks input sites |
| C42 | HTML entries declare `viewport-fit=cover`; CSS sets explicit per-theme `color-scheme` and `paintTheme` syncs `documentElement.style.colorScheme`. | M `test/ui-guidelines-static.test.ts` checks HTML, `src/styles/shadcn.css`, `src/theme.ts` |
| C44 | Global `keydown` listeners guard against editable targets or Escape-only dismissal. | M `test/ui-guidelines-static.test.ts` inspects global `keydown` handlers |
| T6 | Rendered transcript `<pre>` and `<code>` elements set `translate="no"`; `transition-all` and `hover:font-*` weight shifts are banned. | M `test/ui-guidelines-static.test.ts` checks `src/detail/` and utility classes |
| T7 | Chinese UI copy uses typographic `…`, single spaces around standalone numeric units like `10 MB`, and `text-autospace: normal`. | M `test/ui-guidelines-static.test.ts` scans CJK strings and `src/styles/app.css` |
| V31 | UI chrome forbids light font weights below 400 (`font-thin`, `font-extralight`, `font-light`) and sets `-webkit-text-size-adjust: 100%`. | M `test/ui-guidelines-static.test.ts` scans weights and `src/styles/app.css` |
| A8 | WCAG 2.2 target size minimum (SC 2.5.8): interactive controls outside inline prose links measure at least 24 by 24 CSS pixels on desktop and 44 by 44 on touch. | M `e2e/design-rules-guidelines.spec.ts` |
| A9 | WCAG 2.2 focus not obscured (SC 2.4.11): tabbed controls are not covered by sticky headers, docked composers or overlays. | M `e2e/design-rules-guidelines.spec.ts` |
| A10 | Drag-reorderable lists keep pointer drag and keyboard reordering (Space + arrow keys on the row or drag handle) without extra hover up/down move buttons (owner decision 2026-11-27). | M `e2e/providers-order.spec.ts`, `e2e/settings-routing.spec.ts` |
| V32 | Titles are 18px at 600, body 16px and UI text 14px at 400 or 500; text has two inks, primary `ink` and secondary `ink-2` (light `#181818`/`#545454`, dark `#ededed`/`#b0b0b0`), besides the V5 role colours. | M `e2e/design-rules-measure.spec.ts`: computed title, section, label and secondary text in light and dark, 1440px and 390px |
| V33 | Radii scale with component size from tokens (8px controls/items, 12px cards/sheets, 14px menus/composer, 18px bubbles; concentric outer = inner + padding; zero arbitrary pixel radii). | M `test/design-doc.test.ts`; G `ui-debt-gate` |
| T8 | No taglines, subtitles or explanatory text — convey hierarchy by type, alignment and spacing; helper text only ratchets down. | M `test/settings-row-status.test.ts`; G `ui-debt-gate` (helperText); H |

docs/design/surfaces/motion.md:
| Id | Rule | Check |
|---|---|---|
| V24 | Motion names its properties: no `transition-all`, no hover transform, no transitions on layout properties; reduced motion honoured. | M; G `test/unslop-signs.test.ts` |

docs/design/surfaces/tasks.md:
| Id | Rule | Check |
|---|---|---|
| C10 | A row that stands for work shows state and age, grouped by what needs the user; per-surface details live in the surface files. | H |

</details>

## Out of scope

- No UI to edit/retry from trace, no new instrumentation provider, no backfill of never-recorded metadata, no auth or merge-queue changes. Keep agent-facing `inspect_run` behavior and existing inline WorkTrace behavior.

## Review

- Verdict: CONCERNS
- Plan-SHA256: 3a3953fb6fd4de0cc495bcfe9e9bda3541675ed0b2b8071ec19bcf2e795b8d54
- Author-Model: openai-codex/gpt-6.2-sol
- Reviewer: pi, independent full plan review
- Reviewer-Model: anthropic/claude-sonnet-5-5
- Findings: 1 absent task scope and count fields; 2 insufficient new/red proving assertions; 3 missing failure/interaction edges; 4 unspecified state owners; 5 capture and compatibility unspecified; 6 callers and draft scope unclear; 7 need projection/capture/UI slices and narrow-layout rules; 8 payload and aggregate cost; 9 review and inversion metadata. Notes 10–12: explicitly new files, distinguish production verification, label supplied snapshots.
- Fix-check: PASS
- Fix-check-Plan-SHA256: c320ee8d1f0f89079f3a30f8a5ccd3ab1d0b2b282f8f6091334ef4149119fd2a
