# Search chat messages in Coordinator and project threads — plan, 2026-11-27

## User scenario

A user who installed Cairn today and chatted in the Coordinator home or a project channel (such as project `X`, sending `"第一条：1+1等于几"` / `"第二条：再加2呢"` or receiving `"1+1 等于 2。"`) opens Search from the sidebar magnifier or `⌘K`. They need no prior knowledge of search syntax and no extra accounts, API keys, or local storage: messages already stored on the server are searched directly. When they type `"再加"` or `"1+1"`, matching chat messages appear under a `消息` (`Messages`) group with a single-line snippet and the channel label (`Coordinator` or the project name). Clicking or pressing `Enter` on a hit closes Search, opens that conversation, scrolls the target message into view, and clears the transient `msg` parameter. If the search request fails, the existing error banner (`搜索未能完成，下方仅为本地匹配的结果。`) appears without showing stale cached messages; if a message cannot be located (e.g. deleted or withdrawn after search), a toast (`未能定位到这条消息`) informs the user.

## Scope

1. Add optional `messages` (`searchMessageHitSchema[]`) to `searchResponseSchema` in `packages/shared/src/protocol/search.ts` (omitted when empty for backward compatibility and version skew), and update `packages/shared/test/__snapshots__/snapshot.test.ts.snap`.
2. Extract a single source of truth for chat message visibility in `packages/shared/src/chief-message-text.ts` (`isChiefPromptEcho`, `cleanChiefUserText`, `extractPlainMessageText`, `visibleChiefMessageText`, `isSearchableNotice`) and use `visibleChiefMessageText`, `isChiefPromptEcho`, and `cleanChiefUserText` in BOTH `apps/server/src/services/search.ts` and `collectChiefStream` in `apps/web/src/api/mappers.ts` (for user messages, plain assistant replies, and `chief_notice` rows) so search and chat UI never diverge on visibility.
3. Extend `search` in `apps/server/src/services/search.ts` (accepting `userId` from `apps/server/src/routes-resources.ts`) to scan the most recent `2,000` raw `chief_message` rows per eligible thread (matching the 20-page client jump ceiling of 100 rows/page, and capped at `10,000` raw rows total across active threads ordered by `updatedAt DESC`) across the signed-in user's non-archived, non-internal (`chief-digest-%`, `chief-memory-%`), non-personal-space `chief_thread` rows. Reuse `foldSearchText` and `snippetAround` from `apps/server/src/services/chief-history.ts` for literal Chinese, symbol (`+`, `%`, `_`), NFKC, and multi-term matching. Exclude toolcall/thinking/task-prompt/synthetic/echo/orchestrated/`API Error:`/`retry-parking:`/`runtimeUpdate` rows; include plain user/assistant messages and non-`retry-parking:`/`runtimeUpdate` `chief_notice` rows. Sort global hits newest first and cap at `20` results.
4. Isolate React Query search cache by `teamId` and track `settledQuery` in `apps/web/src/api/hooks.ts` (`useSearchResults(query, enabled, teamId)`). In `apps/web/src/overlay/search-panel.tsx`, only render/activate `server.messages` when `serverQueryText` matches the current query and `!searchFailed`, and reset keyboard `cursor` whenever `query`, `open`, or `serverQueryText` changes. Render `消息` rows (`data-row-kind="message"`, `MessageSquare` icon, single-line snippet, `Coordinator` or `ProjectAvatar` + project name) and update placeholder `'搜索任务、项目、消息…'` in `apps/web/src/overlay/search-panel.tsx` and `apps/web/src/i18n/en.ts`.
5. Add universal `data-message-id={item.id}` anchors on user and robot `<Message>` rows in `apps/web/src/chief/chief-message-rows.tsx`, add `apps/web/src/board/message-jump.ts` (`MESSAGE_PARAM = 'msg'`, `MAX_MESSAGE_JUMP_PAGES = 20`, `messageHitHref`, `messageJumpStep`), strip `msg` in `placeOf` (`apps/web/src/chief/use-chief-surface.ts`), clear `msg` on `ProjectNotFound` in `apps/web/src/routes/board-page.tsx`, and drive bounded earlier-page loading + `scrollIntoView` + failure toast (`未能定位到这条消息`) in `apps/web/src/board/home-c.tsx`.
6. Keep existing todo title search, project name search, syntax filter chips (omitting `messages` when `filters.length > 0`), empty-state navigation rows, and `search_history` agent tool semantics unchanged.

## States, readers, writers, and failure paths

- **`msg` URL param & jump loop**: Written only by `SearchPanel` via `messageHitHref` (clears `thread`, `pane`, `view`, `artifact`, `artifactName`, `tab` while keeping `scenario` and setting `project`+`chat=1` or `chief`). `useChiefSurface` ignores `msg` in `placeOf` so clearing `msg` preserves `linked` Coordinator threads. `HomeC` reads `msg`, resets `pagesLoaded` whenever `msg` or `chiefData.threadId` changes (cancelling prior jump A when B starts), waits while `!loaded`, calls `loadEarlier` up to 20 pages, scrolls `[data-message-id]` into center view and clears `msg` (`replace: true`), or clears `msg` and shows `toastError(t('未能定位到这条消息'))` if `hasEarlier` is false, `failedEarlier` is true, `pagesLoaded >= 20`, or the element is absent from DOM. `BoardPage` clears `msg` if `projectLookup === 'unknown'`.
- **`SearchPanel` query & cache state**: `useSearchResults` caches by `['search', teamId ?? null, trimmed]` and returns `settledQuery`. `SearchPanel` gates `server.messages` on `serverQueryText.toLowerCase() === q && !searchFailed` so fast typing (`A` -> `B` + Enter) or failed background refetches never render or activate stale message hits.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Chinese (`再加`), symbols (`1+1`, `100%_覆盖`), mixed text, NFKC full-width, multi-term queries via `GET /api/search` | Matching messages return with literal symbol matching and NFKC folding | `apps/server/test/search-messages.test.ts` | this change |
| Coordinator (`projectId: null`) vs project thread hits, global newest-first order, tie-break, 20-hit cap, and 2,000-row per-thread reachability window | Hits return newest first up to 20; hits beyond 2,000 rows per thread are not returned unreachably | `apps/server/test/search-messages.test.ts` | this change |
| Same-query isolation across teams, users, archived threads, personal spaces, `chief-digest-*`, `chief-memory-*`, and task `message` table | Visible hit returns while forbidden/foreign/internal-thread rows with the same word never appear | `apps/server/test/search-messages.test.ts` | this change |
| Same-query visibility parity (`user-*` prompt echo, `origin: 'user'`, `synthetic`, `task-prompt`, orchestrated, `toolcall`, `thinking`, `API Error:`, `retry-parking:`, `runtimeUpdate`, `chief_notice`) | Only user-visible messages and non-parking/non-runtimeUpdate notices match; tool secrets never leak | `apps/server/test/search-messages.test.ts` | this change |
| Long message with NFKC folding and newlines; syntax-filter queries (`is:failed`, `project:X`) | Single-line snippet centered on match with `…`; syntax-filter queries omit `messages` | `apps/server/test/search-messages.test.ts` | this change |
| `SearchPanel` renders `消息` hits, isolates stale `serverQueryText` / `isError` / `teamId`, navigates via `messageHitHref`, and `messageJumpStep` handles focus, 20-page cap, cancel-on-retarget, and missing/failed states | Stale or failed results never render or activate; click/Enter routes to target thread and jump loop resolves or fails cleanly | `apps/web/test/search-messages.test.ts` | this change |
| End-to-end search palette click/keyboard jump, `[data-message-id]` scroll, `msg` cleanup, missing-message toast, 390px layout, and light/dark WCAG 2.2 AA | `消息` group renders hits without overflow or axe violations and scrolls the target message into view | `apps/web/e2e/search-messages.spec.ts` | this change |
| Searching syntax-filtered messages (`project:X`, `after:7d`) | Syntax-filter queries search tasks only in this slice | `apps/server/test/search-messages.test.ts` | later: message-search-filters |
| Task-specific (`message` table) build transcript search | Build transcript messages are not searched in this slice | `apps/server/test/search-messages.test.ts` | later: task-thread-message-search |

## Out of scope

- Searching per-task build transcripts (`message` table) in `GET /api/search`.
- Syntax-filtered (`project:`, `after:`, etc.) message search.
- SQLite FTS5 virtual tables or schema/drizzle migrations (bounded per-thread batch scan avoids persisted-state risk and supports CJK substrings and symbols natively).
- Client-side offline search across unloaded message history when `/api/search` fails.

## Review

- Verdict: PASS
- Plan-SHA256: 998aef83010f191c48727c8c88de42bd066742b7dd479795510298e000a5b65e
- Author-Model: google/gemini-4-neon
- Reviewer: pi-review (gpt-6.2-sol)
- Reviewer-Model: openai-codex/gpt-6.2-sol
- Findings: 7 findings from round 1 resolved and confirmed (2,000-row per-thread / 10,000-row total reachability-aligned scan cap; universal data-message-id anchor + complete msg jump ownership/cancellation/error toast; SearchPanel teamId cache isolation + settledQuery stale/error guard; shared visibleChiefMessageText parity between search.ts and mappers.ts; tight plain-text query scope; non-hollow proving tests)

