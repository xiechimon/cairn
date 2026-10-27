# 05 · M6 functional-parity final verification · acceptance report (#232)

> Canonical status: this volume = the acceptance-report landing surface required by volume 03 §2's M6 exit (`docs/spec/`).
> Single criteria source = volume 04; stack and pins = volume 01; architecture obligations = volume 02; build order = volume 03.
> Live-run environment: darwin arm64 / Node 26.8.1 / pnpm 12.5.1 / ffmpeg 9.0.2 (local full matrix);
> the CI surface = ubuntu Node 24 (the existing ci.yml gates).
> Execution date: 2026-09-25 (#232; Q1 ruling A = a full-criteria re-run; the 2026-09-23 first-round records are compressed to a one-line pointer in Appendix A).

## 0. Summary of results

| # | Item | Result |
|---|---|---|
| V1 | All built web screens on the real API (fixture alive only in dev/parity) | ✅ 15 routes + the chief dual surface + the ⌘K panel live-wired; the four resource-family creation popovers (provider/secret/mcp/agent) and the add-machine popover (#181) landed; the feedback route removed per the #149 ruling (unmatched paths fall back to the catch-all redirect); `?scenario=` retired to dev/parity-only (#58 gate, compiled away in production builds) |
| V2 | live streaming connected to the real SSE | ✅ the conversation stream (an in-vocabulary endpoint added) with four event forms finalized; the daemon's throttled text_delta forwarding; E2E asserts all three families — text_delta/message/step — arrive |
| V3 | the E2E main-timeline full chain green (01 §7.4 spine) | ✅ integration/test/m5-web-e2e.test.ts 3/3: main timeline + rejection branch + the scheduled round stopping at review, zero UI reloads (this ticket's re-run: 9.57s) |
| V4 | the full pixel matrix (including #229's 22 popover-family rows) with 0 failures | ✅ 229 rows all green (run by this ticket, see §2) |
| V5 | wire side-by-side all green | ✅ the full vocabulary's endpoints in place + the schema-snapshot surface; the full vitest run: 52 files / 505 cases green (see §3) |
| V6 | volume-04 §4's behavior checklist checked item by item | ✅ see the item-by-item table in §4 |
| V7 | the once-per-real-human items | ✅ all three honored: the OS notification permission + a real desktop-notification fire (honored 09-23, Appendix A; this ticket re-confirms per the full-criteria spirit — after the #114 banner landed, the permission entry is in-app) + a real OAuth account connection (honored in the 2026-09-25 ego joint debugging live run, §5's record) — the V7 equivalence note is removed with this connectivity |
| V8 | upgrade tickets open their windows | ✅ the four tickets #104–#107 are closed (#115/#117/#118/#119 landed; window facts in §7) |

## 1. M5 merge implementation notes

### 1.1 The data-source seam (one display contract, two data sources)

- The display contract (`apps/web/src/fixtures/records.ts`) = the component-props surface frozen by the pixel matrix, **untouched**;
  the live data layer (`apps/web/src/api/`) projects the 02 §6.2 wire records into the same display contract:
  - `client.ts` same-origin fetch (a single error shape `{error}`, 04 §3);
  - `hooks.ts` TanStack Query v5 (01/S8 pin 5.103.1) query/mutation surfaces,
    with invalidation-and-refetch as the only server-state strategy;
  - `sse.ts` native EventSource dual channels (the team stream → `invalidateQueries` hint signals =
    the S8 canon; the conversation stream → the transcript live surface);
  - `mappers.ts` the wire→display projection (transcript assembly / plan.md sectioning / unified-diff
    line-number expansion / token-count forms / run-history rows / the chief stream);
  - `live-text.ts` the text_delta typing buffer (useSyncExternalStore; converges and clears the moment the final message row persists — the stream-side half of 02 §1.2's double safety net).
- The mode gate (`api/mode.ts`): `?scenario=` in a dev/parity build → fixture; everything else
  (production builds are always real) → live. The parity matrix and the existing reject-chain e2e's fixture
  data surface is unchanged.
- The desktop-notification divergence honored (04 §5/A5): SSE notification events → in-page `new Notification()` when `document.hidden`; no Web Push/VAPID (registered criterion, not judged negative).

### 1.2 The server completion surface (within the vocabulary + [inferred] registrations)

- **conversation stream**: `GET /api/conversations/{id}/stream` (within the vocabulary).
  Four finalized event forms = ping / message / text_delta / step (payloads [inferred], a single source
  in shared `conversationStreamEventSchema`, snapshot-frozen; the official per-event payloads were not enumerated —
  capture later and write back to tighten 02 §11). Publication points: live tool lines (reportTool), transcript finals
  (receiveUpload), step states (enqueue/claim/finish), the rejection user line, the merge line, the 🎉 line,
  and chief message lines.
- **daemon live-text forwarding**: pi's `text_delta` aggregated in a 250ms window → `POST tool/{stepId}`
  in the third form `{kind:"transcript_delta",text}` ([designed], registered in shared machine-wire.ts;
  the 13-endpoint vocabulary paths do not change shape); the server forwards transiently without persisting, the final version falls back to upload-urls.
- **The vocabulary-completion GET/POST families** (02 §6.1 canonical, 03 §5 "M5 wire = all endpoints"):
  teams/{id}/machines · models · progress · skills/{sid}(+/file) · agents/{aid}/tasks,
  GET/POST /api/skills, whats-new, analytics/first-touch + /_mp/api/track (the vocabulary's "may be a no-op" = accepted with 204 then discarded). preview-token is not implemented = volume-04 Appendix B's "recorded but undesigned" (no UI/wire touchpoint; trigger condition not met).
- **[inferred] build-detail read surfaces** (registered in wire.test INFERRED_ROUTES, paths per the builds/{id}/…
  REST same-family rule): plans (the version set + contents, r5 §4 touchpoint) · changes (the conv branch vs the default branch unified diff, r7 27 touchpoint) · changes/file (on-demand single-file full text, #224) ·
  usage (the token four dimensions, r3 §3.8/r7 30 touchpoint). The steps read surface exposes journal fields
  status/checkpointCommit ([designed]; under zod strip, stepRecordSchema comparison does not drift).
- **SPA static same-origin hosting (02/A1)**: ctx.webDir → non-API GETs serve static files / the SPA falls back to
  index.html; misses under /api, /git, and /_mp are always 404 JSON (the error-shape comparison surface unbroken); path-escape
  rejection; index no-cache + assets 1h. The E2E and the production form are isomorphic (same-origin cookie/SSE without proxying).
- **The OAuth handshake surface (#231)**: `POST /api/teams/{id}/providers/oauth/{preset}/authorize`
  issues + `/api/oauth/callback` receives the code and 302-redirects back (the token never enters the redirect; the result is passed via
  the `?oauth=connected|error` query parameter); the family table = the single source shared `OAUTH_FAMILIES`,
  the current single family = github-copilot (four items: authorize URL / token URL / scope / providerBaseUrl).
- **The GitHub outbound surface (#223)**: an outbound-fetch thin bridge + `POST /api/skills/scan` for the scan-and-discovery half
  (the skill-import surface's data source).

### 1.3 The live-wired built-screen list (V1 screen by screen)

| Screen | live data surface | live write surface |
|---|---|---|
| board | todos/projects/machines/notifications/chief+threads (SSE direct update) | new task, save-and-start, card-surface start, drag sorting (orderIndex PATCH), review complete → accept → merge, edit assignment (#209, PATCH assignment two slots) |
| todo detail | todo/build/steps/messages/plans/changes/changes-file/usage/machines + the conversation stream (the typing surface) | start/confirm/reject (composer→revision)/accept-merge/rerun (plan first · execute now · reuse plan = execute directly)/delete; the docpane "show full file" button wired to #224's on-demand full-text endpoint (#225) |
| schedules | GET /api/schedules (SSE todo linkage) | new schedule (frequency tabs + controlled minute tiers → POST; 02 §9.2) |
| machines | GET teams/{id}/machines (+ the hosted-row canon) | the add-machine popover (#181, the r2 11b CLI two-step form: an install/run command block with copy + an API-key disclosure with the teamId link embedded); the row's three inline action icons removed from the books (#222, endpoint verification measured no local-first machine-management surface, so no dead buttons are rendered) |
| model services | the GET providers envelope (+ the built-in-row canon) | the creation popover live (POST providers); the "connect subscription" section = the #231 OAuth single-family entry (github-copilot, authorize → same-tab jump to the authorization page → back to the list row) |
| secrets | GET secrets (rows present = the resource-row card language presentation [designed]) | the creation popover live (POST secrets, the write-then-unreadable criterion) |
| skills | GET /api/skills | new skill: a folder-directory picker → the file-set POST (SKILL.md required = the server's 400 counterpart); GitHub scan-and-import (#233's endpoint + #235's button wiring: the scan dual-mode consumption, picking from the candidate list imports immediately) |
| MCP servers | GET mcp-servers | the creation popover live (POST mcp-servers, http/stdio dual forms, #174's dlg-seg ruling) |
| team | GET members (the Agent card grid = the actor projection) | the create-Agent popover live (POST agents) |
| API keys | GET api-keys (masked rows) | new key = direct issue with default permission bits + a one-time plaintext block (the r3 §6 permission-bit form popover = a follow-up ticket, §6) |
| account | GET /api/user/me (the name row); the email = a placeholder dash (the replication has no email-account surface [designed]) | the language dropdown (#74); the push-notification switch (mirroring Notification.permission, same path as #114) |
| project ×3 (detail/settings/new) | GET projects/tree + todos filtering | new project (POST → hosted bare lands → jump to the project page); the file viewer (#202, /file on-demand, encoding-based rendering); the settings delete section (#207, the DeleteProjectConfirm type-the-project-name gate → DELETE /api/projects/{id} cascading delete) |
| chief drawer | GET chief/threads + the active thread's messages + the conversation stream | send message (new topic POST threads / continue message POST conversations messages); thread switching |
| chief settings | live = the canon static-surface presentation (the binding state / the model slot's real values) | the Agent-binding popover, the charter-editing popover, the compression-model anchored menu (#204, the PATCH compactionModel slot); the memory/watch two tabs = placeholder copy canon |
| ⌘K search panel | live todos client-side filtering (real data); the project chip's real name | the GET /api/search endpoint is in place but unconsumed (the panel contract = client-side filtering, §6) |
| feedback | the route removed wholesale (#149's local-first ruling, the #129 precedent) — the old path falls back to the catch-all redirect | — |

The project chips on cards/search/new-task dialogs = the `FixtureSet.projectNames` slot (live real project names;
the fixture surface defaults to the capture-canon constants when absent, zero matrix drift).

### 1.4 The M6-window increments (landed between the 09-23 first round and this ticket's start, the reason for the full re-run)

- batch2: #221 the popover-style-family wholesale extraction (six popovers' CSS collected into the .dlg-form-* shared layer),
  #223 the GitHub outbound-fetch thin bridge + the skills/scan endpoint, #224 the diff full-text read surface, #225 the docpane "show full file" button wiring (merged via #237).
- #229: the popover-family open states' 22 rows enter the parity gate (8 popovers 11 surfaces light+dark, the M6 Q3 ruling;
  #172's old ruling "popovers do not enter parity" is abolished).
- #230: the provider/agent/mcp three families' POST body schemas promoted to the shared single source
  (the six create/patch items; routes.ts deletes its local definitions and switches to import-consumption, the web mutation sites take types).
- #231: the github-copilot single-family OAuth handshake connected end to end + the web connect-subscription entry + the connected-account wizard
  (`scripts/connect-github-copilot.sh`).
- #233/#235: GitHub scanning for the skill-import surface (endpoint + button wiring).
- Other tickets in the same window: #181 the add-machine popover, #202 the project file viewer, #204 the chief compression-model flip-back interaction,
  #207 the project-delete section revived, #209 the edit-assignment wiring, #222 the machine-row inline icons removed from the books,
  #216 the runGit stdin EPIPE flake fix, #194 the e2e inline-import sweep.

## 2. The pixel-parity layer (V4)

- Matrix: **229 rows fully run, 0 failures** (local darwin, `PARITY_PORT=8390`; artifacts archived in
  parity/output/report.json, gitignored).
- Composition: 67 gate rows (63 at the 0.85 tier + 4 at the 0.84 tier) + 143 smoke rows (SSIM=1.0 self-comparison +
  expectText content teeth) + 19 report-only rows (report without gating).
- The current four examples at the 0.84 tier (row notes register the reason + a blend human-check showing no structural difference, per 04 §2's rules):
  `detail-confirm-light` / `detail-usermenu-click-light` / `detail-done-light`
  (cross-platform font-rasterization noise) + `detail-failed-light` (CJK wrap points drifting with the renderer's font stack). Volume 04 §2's parenthetical "current two examples" is a snapshot at the #45 point; the latter two were registered by their tickets, the criterion unchanged.
- This ticket's lowest-scoring gate row: `detail-failed-light` 0.8459 @ 0.84 (margin 0.006, the known CJK-wrap drift surface, registered).
- Double-run around baseline changes: this ticket is a pure-acceptance ticket (zero app-code changes), so one full run is the baseline;
  the starting point = origin/main @ a2773a13 (#229/#230/#231/#233/#235/#237 all landed).
- The threshold system = 04 §2 verbatim; this ticket adds no new overrides and no new report-only rows.
- The CI gate (drizzle drift + typecheck + vitest + lint + parity + the full web e2e) =
  the existing ci.yml steps, unchanged.

## 3. The wire layer (V5)

- Vocabulary side-by-side (apps/server/test/wire.test.ts, 22 cases): the M2a core surface / the M2c key-and-search
  surface / the M5 merge surface (M5_ROUTES: the vocabulary-completion family + the conversation stream + `/_mp/api/track`
  explicitly in place) / "no paths invented outside the vocabulary" all green; the four INFERRED_ROUTES registered rows = plans /
  changes / usage / changes/file (#224's full-text read surface registered in the same family).
- Schema snapshots (packages/shared/test/snapshot.test.ts): the 24 record-shape tables' zod →
  JSON Schema projections + body/envelopes + the AgentBackend seam / the machine-surface wire + the four protocol-vocabulary families' snapshots;
  after #230's promotion, the provider/agent/mcp three families' six create/patch items enter the shared single-source snapshot surface.
- Vocabulary pins (vocabulary.test.ts): the nine-value phase authority single source / the machine protocol (02 §5) /
  the web REST vocabulary (02 §6.1) / the SSE channels / the MCP vocabulary (02 §7.2 = the r3 §6 matrix 1:1) /
  the worker memory three-piece set / the brand-slot constants (02 §5.8 + the asset-replacement-plan §2).
- The machine surface's 13-endpoint vocabulary does not change shape: the delta third form = a payload extension of the existing path [designed],
  registered by the same-family MACHINE_WIRE_EXTENSIONS mechanism.
- Full vitest: **52 files / 505 cases all green** (server 25 / daemon 8 / web 7 /
  shared 4 / integration 8; 12.99s, projects in parallel).

## 4. The behavior checklist item by item (04 §4's scenario table, V6)

| Group | Scenario | Verification surface | Result |
|---|---|---|---|
| M2 | REST/SSE-surface CRUD, team-stream events, the search panel, schedule CRUD + the trigger closed loop | server test/wire.test.ts · sse.test.ts · schedules.test.ts · search.test.ts (green within the 505 cases); the web search panel live (client-side filtering on real data, pinned by the search-focus / search-result-rows e2e) | ✅ |
| M3 | machine onboarding (claim~75s+wake), the worktree contract, checkpoint/recovery, upload-urls, merge 202 delegated, the free one-machine limit | integration m3a-demo · m3b-demo · crash-recover (all green); m5-web-e2e re-proves the merge 202→done chain | ✅ (crash-recover has a known occasional CI flake — the re-run confirmation criterion, do not judge it a regression) |
| M4 | the Chief six items (wording→spec / dispatch weights / direct dispatch / the watch-wake three triggers / rejection v2+diff / dual-Agent slots / the memory four items) | server chief.test · m4a-chief-loop · m4b-memory; integration m4a/m4b×3 (all green); the web chief-drawer live conversation surface (pinned by the chief-panel / chief-settings e2e) | ✅ |
| M5 | the end-to-end lifecycle live run (including the rejection branch and the scheduled round stopping at review), board card-state transitions, the detail deep-layer states | integration/m5-web-e2e.test.ts re-run by this ticket 3/3 (9.57s): ① create → plan → confirm → execute → review → merge → done (zero UI reloads + the conversation stream's three event-family assertions + the main-landing truth) ② reject → v2 → the version-compare diff → confirm → review ③ an once-schedule → tick → direct execution → stopping at review + the `由定时发起` marking; the reject-chain (fixture surface) e2e green | ✅ |
| M6 | the once-per-real-human items | see §5's record | ✅ all three honored |

Targeted web-e2e re-runs (this ticket, E2E_PORT=8399): reject-chain · notify-banner ·
provider-oauth · search-focus · search-result-rows · chief-panel ·
chief-settings, seven specs **35/35 green** (9.6s).

## 5. The once-per-real-human items (the M6 row) · records of honor

All three honored. The two notification items were honored on 09-23 (Appendix A pointer); this ticket re-confirms per the full-criteria spirit:
the code paths are verified in place — the permission entry is the in-app banner (#114, notify-banner.tsx drives
`Notification.requestPermission()`; the account-page push-notification switch takes the same path), and the fire path
is `sse.ts` = an SSE notification → in-page `new Notification()` when `document.hidden`
(the three types: plan_ready / build_review / chief_message).

**Real OAuth account connection (2026-09-25, ego browser-driven joint debugging live run)**: the GitHub OAuth App
`pacman-local-m6` registered → Client ID/Secret into `.env` → the server started on port 8795
(an isolated data root) → in-app "connect subscription" → GitHub Copilot → the authorization page Authorize →
the callback 302 redirect → the providers API row lands: `providerId = github-copilot`,
`baseUrl = https://api.githubcopilot.com`, `api = openai-completions`,
**no apiKey field** (the token-sealed write-only-unreadable rule holds). The V7 equivalence note is removed with this connectivity
(the 09-23 credential-chain equivalence-path record is archived with Appendix A).

The rerun/switch-family criterion (the ready-state operation table is kept):

| # | Item | Operation (ready state) | Expected observation |
|---|---|---|---|
| 1 | the OS notification-permission popup allowed by hand (02 §9.1 / 04 §5) | `pnpm --filter @pacman/web build` (on first run or when changed) → `pnpm dev:server` (web same-origin hosting, default 8787) → open `http://127.0.0.1:8787/app` → click `开启` on the notification banner at the top of the board (or the account-page push-notification switch) → click `允许` on the system popup | the banner disappears; Console `Notification.permission === 'granted'` |
| 2 | a real desktop-notification fire (04 §5's divergence criterion A5) | after permission is granted: open any detail page → **move the tab to the background** → trigger a notification event (another client creates a todo and saves-and-starts → plan_ready fires when planning completes; or wait for a scheduled round) | during the backgrounded tab, a desktop banner pops (title/body = the event copy); switching back to the foreground, the in-page unread badge links |
| 3 | a real OAuth account connection (#231's single family = github-copilot) | run `bash scripts/connect-github-copilot.sh` at the repo root (a five-phase wizard: set the origin → register a GitHub OAuth App → copy the Client ID/Secret back into `.env` → start the server with the env → connect); or follow the script's steps by hand | the GitHub Copilot row appears on the model-services page list; the redirect URL carries no `?oauth=error` (reason=denied = the authorization page cancelled; reason=exchange = client secret / callback URL mismatch; reason=state = state missing/expired, #243 — re-issue the connection to fix) |

- Criterion: the family table currently has only the github-copilot family; extending the chatgpt/codex/xai families belongs to follow-up tickets (§6-12).
- The divergence criterion is unchanged: no Web Push/VAPID (ruled in 04 §5, not judged negative).

## 6. Registered surfaces (divergence / [inferred] / deferred)

1. **preview-token**: recorded but undesigned per volume-04 Appendix B — no UI/wire touchpoint, not implemented (the trigger condition has not arrived, not a gap).
2. **The browser authorization page** (02 §5.2 path one): the server-side enroll/start/poll skeleton is in place;
   the web `/app/machines/authorize` page is not built — the machine-onboarding main path = the CLI `--api-key
   --team` (path two, the E2E/docs criterion), #181 already landed "add machine" as the CLI two-step-form
   popover (an install/run command block + the API-key guidance), and the authorization page itself belongs to a follow-up ticket.
3. **streamdown (01/S7)**: the transcript rendering = a self-built segmented renderer (unified with the pixel-contract DOM —
   the same presentation surface in fixture/live modes, zero parity-row risk); introducing rich-markdown/math via streamdown
   belongs to a follow-up-ticket evaluation (introducing it changes the DOM contract and requires matrix re-verification).
4. **The steer slot** (02 §5.6 vocabulary): the daemon seam is in place (AgentSessionHandle.steer);
   the web building-state composer has no REST write surface (the vocabulary has no endpoint) — sending only takes effect at the confirm gate
   (revision), and sending in the building/review states is inert.
5. **The search server surface**: GET /api/search is in place (02 §6.3's [designed] self-set); the panel contract is
   client-side filtering (live todos, real data); switching to the server side belongs to a follow-up ticket.
6. **~~the form-popover-family follow-up ticket~~ (dissolved)**: the provider/secret/mcp/agent creation popovers are all live
   (real POST write surfaces + e2e pins + the #229 parity open-state rows); the POST body schemas were promoted to the shared single source via #230
   (the six create/patch items), and the web mutation sites take the Create*/Patch*Body types — the two accompanying obligations registered on 09-23 are both honored. The remaining item: the API-key permission-bit form popover still belongs to a follow-up ticket (new keys = direct issue with default permission bits, unchanged).
7. **The run-history tokens slot**: non-current rows lack the tokens frame — the mapping layer
   (`mapRunHistory`'s `tokensByBuild` slot) and the per-build usage endpoint are both in place;
   the caller-side on-demand data surface is unwired, belonging to a follow-up ticket; the current row / failure row / relative time / error string are complete.
8. **The account email row**: the replication has no email-account surface (02 §2.1 auto-login) — a placeholder dash [designed].
9. **The conversation-stream payloads**: [inferred] finalized (four events); the official-payload capture trigger = volume-04 Appendix A's discipline (write back to 02 §11).
10. **The i18n-coverage `api` directory exemption**: the data-layer record content strings are of the same family as fixtures (the zh-CN
    authoritative canon; the component `t()` sites honor the en fallback) — registered in a test comment.
11. **The fixture table inside the production bundle**: the scenario choice is compiled away in production builds
    (#58 gate), and the live data path does not consume fixture content fields; the fixture data table itself is still in the
    bundle (shared by dev/parity as a single source) — collecting it via dynamic imports to shrink the bundle belongs to a follow-up ticket (a pure size optimization, not a data-surface residue).
12. **The OAuth-family form family** (#231's new registration): OAUTH_FAMILIES currently has only github-copilot;
    adding the chatgpt/codex/xai family = a family-table row addition + the preset button following, belonging to a follow-up ticket.
13. **The OAuth state TTL × handoff interval** (the small-bug evidence caught by #232's live connection run):
    the state TTL = 10min (`OAUTH_STATE_TTL_MS`, [designed] "enough for a real human to walk the authorization page once"),
    and the first authorization's handoff interval exceeded the TTL, so the callback took the bad-state branch = a bare 400 JSON
    "oauth state expired" — not redirecting is the code-side intentional shape (when the state is not registered, the
    returnOrigin is untrusted; routes.ts bad-state → HttpError 400); a retry (GitHub jumping straight through in the already-authorized state)
    passes in seconds, and the function is not judged negative. The bare-JSON landing experience belongs to a follow-up-ticket evaluation (static error page /
    re-authorization guidance direction). **Closed (#243)**: the bad-state missing/expired two forms uniformly 302 back to the
    providers page with `?oauth=error&reason=state` (expired carries the registered entry's trusted origin;
    unregistered takes the relative Location), and the TTL rises to 30min of human-loop margin.

## 7. Upgrade-ticket window facts (03 §3's cadence, four tickets closed)

| Ticket | Content | Landing |
|---|---|---|
| #104 | TypeScript 5.9.3 → 7.0.2 (toolchain-compatibility verification) | #117 (the i18n gate switches to the TS7 unstable/ast scanner, the TS5 AST oracle verified token-equivalent; 01-volume §4.5 pin written back) |
| #105 | react-router 7.18.4 → 8.4.0 (library-mode regression + route-shape fidelity) | #118 (all v8 Breaking entries outside the seams; 01-volume §4.1 pin written back) |
| #106 | Tailwind 3.4.19 → 4.x (the dark-inversion-variant equivalence + full-matrix re-verification) | #119 (@custom-variant equivalence replication + the @theme inline migration; the full parity matrix re-verified with 0 failures) |
| #107 | pi 0.85.1 → 0.86.0 (the first D6 window: reading the Breaking section + the AgentBackend seam regression) | #115 (all three Breaking entries outside the seams, a pure pin bump) |

The current catalog truth: typescript 7.0.2 / react-router 8.4.0 / tailwindcss 4.3.3 /
@earendil-works/pi-* 0.86.0 — this ticket's 229 parity rows + 505 vitest cases all green are the full-criteria re-verification after the four tickets landed.

## 8. Run records (2026-09-25 final numbers)

- parity: 229/229 rows 0 failures (67 gate + 143 smoke + 19 report-only; the lowest gate row
  `detail-failed-light` 0.8459 @ 0.84).
- Full vitest: 52 files / 505 cases all green (12.99s, projects in parallel; including integration
  m3a/m3b/crash-recover/m4a/m4b×3/m5-web-e2e).
- E2E spine re-run: m5-web-e2e 3/3 (9.57s).
- Targeted web e2e: seven specs 35/35 green (9.6s, the list at §4's tail).
- Three gates: typecheck green across 5 packages / lint (biome ci) green / format clean.

## Appendix A · the 2026-09-23 first-round record pointer

The first round (the M5 merge #83 + the first honoring of M6's once-per-real-human items) is fully recorded in git history: this volume @
`1c92cb6c` (2026-09-23, including the permission-grant / desktop-fire two real events / the credential-chain equivalence-path full chain
build→merge→main step-by-step records) and PR #108. This version covers it with the #232 Q1 ruling A full-criteria re-run and does not restate it.
