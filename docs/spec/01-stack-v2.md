# 01 · Tech-stack locking v2 (todos.dev replication)

> Wayfinder ticket: xiechimon/pacman #43 (`wayfinder:grilling`, decision 2026-09-20, two rounds of all-frontier rulings).
> Methodology inherited from the old 01-stack (`git show 131620e:docs/spec/01-stack.md`, the nanobot replication volume; only the methodology survived the repo pivot): lock item by item, implementation sessions have zero selection authority, interface replacement seams, pin discipline, side-by-side acceptance.
> Boundary inheritance: `00-foundation-decisions.md` D1–D7 (cited as `00/D*`); `02-architecture-parity.md` A1–A12 (cited as `02/§*`); vocabulary and entity boundaries = root `CONTEXT.md`. Upstream evidence: `docs/research/r1-site-inventory.md` (cited `r1 §…`), `r2-app-ui-inventory.md` (`r2 §…`), `r3-protocol-executor.md` (`r3 §…`), `r4-foundation.md` (`r4 §…`).
> npm versions are **measured from the 2026-09-20 registry** (latest or specified tag); pi-family versions follow the 00/D6 canon.
> Type notation: **inherited** (carries over the old 01-stack or existing 00/02 decisions) / **locked** (newly decided by this ticket) / **[designed]** (not observable on the official side, self-set by the replication) / **[inferred]** (black-box approximation without first-hand observation) / **handed off** (this volume fixes only the boundary; the detailed plan belongs to another ticket).

## 0. Summary of conclusions

| # | Decision | One-liner |
|---|---|---|
| S1 | Same-stack principle | **Pixel parity does not require the same stack**; acceptance = "indistinguishable from the user's perspective" (#34 wording), each item carries an observed-stack-difference note (§8) |
| S2 | Frontend form | **Single Vite + React SPA**: landing and workspace in the same app, separated by routes; no Next.js/SSR |
| S3 | runtime | **Node 24 LTS** (`engines >=22.19.0`, pi's floor), CI matrix 22/24; Bun not introduced |
| S4 | Storage | **SQLite (better-sqlite3) + Drizzle**; the schema surface = projection of the 02 §6.2 record shapes (§6) |
| S5 | Style system | **Tailwind 4.3.3** (#106 upgrade window; observed same-version-period 3.4.19 → v4, §4.1) + CSS-variable token layer + Radix (`radix-ui` unified package) + cmdk; the dark-default `.light` inversion trick replicated as-is |
| S6 | i18n | **Layered, isomorphic to the official asymmetry**: landing in four languages / docs in en+zh-CN only / legal in English only / workspace zh-CN authoritative + en fallback; react-i18next |
| S7 | Streaming rendering | **streamdown** (built-in shiki + katex + streaming half-render safety), patch-pinned |
| S8 | State and data layer | **TanStack Query v5** (SSE events → `invalidateQueries`, honoring 02 §1.2) + **Zustand**; localStorage key names per the r2 §1.5 contract |
| S9 | daemon distribution | **Pure-JS npm package** (esbuild single file + node shebang); no replication of the 6-platform binaries |
| S10 | git operation layer | **spawn the system git + a self-built thin wrapper** (vocabulary = the 02 §5.5 contract); `git http-backend` CGI on the server side; isomorphic-git/simple-git not introduced |
| S11 | Batch inherited surfaces | Hono, zod 4, pnpm+catalog, Biome, vitest+playwright, commander+clack, pino, cron-parser, TS 7.0.2, ESM nodenext, PWA carried over as-is, keyfile AES-256-GCM, EventSource, undici proxying (§4.5) |
| S12 | AgentBackend seam | Lives in `packages/shared`; event surface = 02 §5.6 pi vocabulary 1:1 (signature draft §5) |

---

## 1. Positioning and adjudication principles

This volume **locks every tech selection** the replication implementation needs, item by item. After receiving 00 + 02 + this volume, the implementer makes no selection decisions of any kind; only decisions change, not implementations. 00 fixes the foundation boundaries (engine/craft tier/UI foundation/pin discipline), 02 fixes the architecture canon (process topology/protocol contracts/security boundaries), and this volume pins the engine and the per-item pin table — the three-volume division of labor is exactly 00's "Impact on downstream tickets" section and 02 §10's handoff checklist; this volume closes item by item.

**S1 same-stack adjudication (the ticket asks "does pixel parity require the same stack")**: **it does not**, and "same stack" has no single object — the official side itself runs two heterogeneous stacks (landing = Next.js App Router SSG, evidenced by r1 §1.1 headers; workspace = atomic-class `r-*`/`css-*` DOM → **[inferred] React Native Web / Expo family**, r2 §92). The acceptance criterion "pixel-level UI + functional equivalence, indistinguishable from the user's perspective" constrains the rendered result and behavior, not the build stack. RNW replication cost is extremely high and conflicts with 00/D5 (React from scratch + Radix + self-built tokens), so the same-stack route does not hold. **The obligation translates into**: every decision carries an observed-stack-difference note (§8 aggregate); unobservable spots are marked [designed]/[inferred]; pixel side-by-side targets = the r1/r2 screenshots and CSS-capture originals.

## 2. Observed-stack baseline (the factual basis of the difference notes)

| Surface | todos.dev observation | Source |
|---|---|---|
| landing framework | Next.js App Router, SSG pre-rendering (`x-nextjs-prerender: 1`, `/_next/static/*`) | r1 §1.1 |
| landing CSS | Tailwind CSS **3.4.19** (file-header banner) + Tailwind Typography (full `--tw-prose-*`) | r1 §1.1 |
| theme | **dark = the `:root` default state**, light = `.light` hung on the root; `dark:*` compiles to `.dark\:x:where(:not(.light):not(.light *))`; `theme-color #18181b`, `color-scheme dark light` identical across all 163 pages | r1 §4.3 |
| palette | zinc pure scale on the dark side, stone warm off-white on the light side; primary accent indigo pure scale; status colors rose/amber/green/gray; shadows not customized (`shadow-sm` mainstay); breakpoints = Tailwind default five tiers | r1 §5 |
| fonts | only 2 woff2 files: Inter + JetBrains Mono; **no CJK webfont, all fallback to system fonts + emoji font families**; CSS variables `--font-inter`/`--font-jetbrains-mono` + Arial-fallback metric overrides (the 859B stylesheet fully captured) | r1 §4.1 |
| workspace framework | **[inferred]** React Native Web / Expo family (atomic-class evidence) | r2 §92 |
| realtime surfaces | **all SSE, no WebSocket** (team stream / conversation stream / machine stream) | r3 §8.1, 02 §1.2 |
| executor distribution | npm -g `@todos-dev/cli` 0.1.52, 275MB package: 6-platform binaries (`@todos-dev/cli-darwin-arm64` etc.) + embedded dependencies; `pi-ai`/`pi-coding-agent` **0.84.3** in plaintext | r3 §1.1 |
| PWA | `manifest.webmanifest` (1,146B) + `sw.js` (3,495B, self-described "notification click routing only, no fetch handler") fully captured | r1 §5.1/§5.3 |
| i18n | `en` unprefixed / `/zh` / `/zh-TW` / `/ja`, `x-default`→en; marketing fully translated in four languages, docs only fully translated in zh-CN, privacy/terms English only; unmatched paths 307 → `/login?callbackUrl=` | r1 §1.1/§8 |
| DB / server framework / state library / markdown rendering stack | **not observable** (server-side black box; frontend inside the minified bundle) | r1 §9, r3 §11 |

## 3. Monorepo layout and pin discipline

**pnpm 12.5.1 workspaces + catalog** (inherited from old §3; turbo deferred — add it when CI duration becomes a pain point). Four packages:

```
apps/web        # SPA: landing (41 routes × locale) + workspace (/app tree), Vite build, separated by routes
apps/server     # Hono: REST + SSE + SPA static same-origin hosting (02/A1) + git http-backend + cron + DB + notifications
apps/daemon     # executor CLI (tds brand slot → #44): claim/heartbeat/worktree/pi session/upload, esbuild single file
packages/shared # protocol vocabulary, record-shape zod schemas, naming-constant table (02 §5.8), AgentBackend seam (§5)
```

Dependency direction: `web / server / daemon → shared`; the three ends have no dependencies on each other; shared has zero reverse dependencies. All ESM (`"type": "module"`), tsconfig `module: nodenext` + `strict`, target Node 24. Shared-dependency versions are unified through the catalog.

**Pin discipline (00/D6 expanded into the per-item pin table = the "pin" column of each table in §4)**: every dependency is exactly patch-pinned; the pi family (`@earendil-works/*`) is pinned at **0.86.0** (00/D6 canon; the first upgrade window #107 already read the 0.86.0 Breaking section and honored it — all three Breaking entries land outside the seams, §9). The post-upgrade-ticket discipline is inherited: no framework major-version bumps before replication acceptance (Tailwind 4 / TS 7 / react-router 8 each get their own ticket, §9).

**Interface replacement seams** (inheriting the old §3 methodology, enforced by lint rules — importing a wrapped dependency directly outside the seam is a violation):

- `AgentBackend` ← pi SDK (§5, the signature landing of 00/D1's seam)
- `GitOps` ← system-git spawn wrapper (vocabulary = the 02 §5.5 worktree contract + §3 http-backend/tree-reading)
- `Settings` ← self-built layered config (zod schema, precedence = explicit args > env > .env > config file > defaults, inherited)
- `SecretBox` ← node:crypto AES-256-GCM (keyfile detailed plan §4.2)
- `Scheduler` ← cron-parser + self-built scheduling loop (02 §9.2 vocabulary)

## 4. Item-by-item decision tables

### 4.1 Frontend (apps/web)

| Item | Decision | pin | Type | Reasoning / observed-stack note |
|---|---|---|---|---|
| framework | React 19 SPA (from scratch, 00/D5) | react / react-dom **19.3.0** | locked | New build with no upgrade debt; take latest 19 directly; the official workspace RNW [inferred] is not replicated (S1) |
| build | Vite + @vitejs/plugin-react; dev-time proxy → server | vite **8.3.0** / plugin-react **6.1.1** | locked | Single SPA with no SSR demand; PWA/desktop shell wrapping an SPA is the smoothest (02 §1.1 premise); official landing Next.js SSG → difference note §8 |
| routing | React Router v8 (library mode), hand-written route table | react-router **8.4.0** | locked | The route table is fixed (41 landing + locale + /app tree); #105 honored the v8 window: Breaking all outside the seams (ESM-only release form, `react-router-dom` removed, middleware always on — this surface has no loader/action so untouched), /app tree + unmatched→/app redirect run faithful; locale shape copied: `en` unprefixed `/zh` `/zh-TW` `/ja` + hreflang alternate + `x-default`→en (r1 §1.1) |
| styling | Tailwind CSS **4.3.3** (#106 upgrade window honored; observed same-version-period = 3.4.19, the r1-compiled-artifact side-by-side baseline unchanged) | tailwindcss **4.3.3** / @tailwindcss/postcss **4.3.3** | locked | v4 CSS-first form: the `dark:` variant = `@custom-variant dark (&:where(:not(.light):not(.light *)))`, the compiled selector character-identical to the official artifact (r1 §4.3, do not do the conventional "light default + dark: prefix"); the token consumption surface (v3 `theme.extend.colors`/`fontFamily`) migrates to `@theme inline` — utility declarations reference tokens.css variables directly, and the `.light` dual-theme override still cascades at the tokens.css level; class-name semantics, the five default breakpoints (640/768/1024/1280/1536), and zero-translation shadow side-by-side obligations unchanged; after the upgrade the full parity matrix of 174 lines re-verified with 0 failures |
| design tokens | CSS-variable layer: the r1 §5 color-name→variable mapping table copied into the `theme.extend.colors` consumption; `--font-inter`/`--font-jetbrains-mono` copied; the zinc/stone/indigo pure-scale semantics preserved | — | locked | The landing form of 00/D5's "self-built tokens"; side-by-side target = the r1 `[f965382e067739e9.css]` original |
| fonts | the 859B `@font-face` CSS already captured by r1 carried over as-is + 2 self-hosted woff2; no CJK webfont, system fallback (a key replication constraint from r1); emoji font families enter the font stack | — | inherited | woff2 files and bitmap-icon downloads belong to the #44 asset checklist (§9) |
| component layer | Radix Primitives (`radix-ui` unified package) + cmdk (⌘K panel skeleton, behavior target = the r2 §8.4 panel form + 02 §6.3 wire) | radix-ui **1.6.7** / cmdk **1.1.1** | locked | 00/D5 already fixed Radix-class + self-built tokens; craft UI is interaction reference only |
| icons | self-built SVG sprite; glyph extraction (capturing the workspace bundle in logged-in state / tracing screenshots) listed in the #44 asset checklist; no lucide placeholders | — | handed off | official icon glyphs are not observable (inside the RNW bundle); placeholder-library glyph mismatch means rework |
| data layer | TanStack Query v5: all server state goes through query-invalidation re-fetch (the replication implementation of 02 §1.2's [inferred] strategy); SSE events serve only as `invalidateQueries` hint signals | @tanstack/react-query **5.103.1** | locked | 02 already locked the strategy; this volume pins the library |
| client state | Zustand; localStorage key names per the r2 §1.5 measured contract (`tds.` prefix = brand slot → #44) | zustand **5.0.15** | locked | the official state library is not observable [designed] |
| streaming markdown | streamdown (react-markdown pipeline underneath + streaming-unclosed-block safety + built-in shiki highlighting + katex math) | streamdown **2.6.0** | locked | the transcript `text_delta` stream (02 §5.6 vocabulary) + plan cards + docs `.tex` math surface (r1 changelog 09-08 measured); the official rendering stack is not observable [designed]; side-by-side target = the r3 transcript line forms + screenshots |
| drag & drop | @dnd-kit/core + sortable (board cards across columns + `orderIndex` sorting within a column) | core **6.3.1** / sortable **10.0.0** | locked | dragging measured in screenshot 85; react-beautiful-dnd unmaintained, not chosen |
| forms | hand-written controlled components + zod validation; react-hook-form not introduced | — | locked | with fully custom pixels, RHF only saves registration boilerplate; the comment box = a native textarea + self-built mention/attachment popovers (the three-button r2 toolbar measured); "voice input" = Web Speech API **[inferred]** (shape parity, best-effort behavior, difference note §8) |
| diff view | npm `diff` for data + self-built rendering (line/word-level highlighting, ~150 lines) | diff **9.0.0** | locked | the plan-card Changes pixel target = screenshot 69; diff2html's built-in styles do not match the target |
| emoji picker | self-built: `Intl.Segmenter` grapheme segmentation + Unicode property-escape validation of "exactly one emoji cluster" (flags/keycaps/skin tones/ZWJ, the semantics measured in r1 changelog 09-08); the common-grid subset belongs to #44 | — | locked | third-party pickers neither match pixels nor stay light |
| dates | date-fns (frontend display layer; locales cover en/zh-CN/zh-TW/ja, exactly matching S6) | date-fns **4.4.0** | locked | the scheduled-form four-tier minute marks / tz-note copy target = r3 §9; backend timezones = built-in `Intl` (§4.2) |
| i18n | react-i18next; **layered criterion (S6, the map fog ruled this time)**: landing fully in four languages (source material = r1 `i18n-*.txt` per-language side-by-side captures); docs fully translated only in en+zh-CN, zh-TW/ja only the 6 marketing pages + changelog (the 92-item sitemap shape copied); privacy/terms English only; **workspace zh-CN authoritative** (all r2/r3 copy canon is Chinese) + en fallback, zh-TW/ja not done | i18next **26.4.2** / react-i18next **17.0.14** | locked | acceptance = indistinguishable from the official, which is asymmetric to begin with (r1 §8); the other two workspace languages have no observable truth to check against, so doing them would produce nothing to compare; the route shape is copied; for unmatched paths the official 307s to `/login?callbackUrl=` — the replication has no login page (02/A2 auto-login), so **[designed]** unmatched → `/app` redirect |
| PWA | `manifest.webmanifest` + `sw.js` **carried over byte-for-byte from the r1 captures** (only brand slots / icon URLs replaced, belongs to #44); no PWA plugin library; `theme-color #18181b` + `color-scheme dark light` identical on every page | — | inherited | the sw.js self-description "notification click routing only, no fetch handler" = the premise of 02 §9.1's notification design; byte-level copying costs the least side-by-side effort |
| notifications | in-page `new Notification()`, fired only when `document.hidden` (02 §9.1 canon); no VAPID/Web Push library | — | inherited | already locked by 02/A12, zero selection left |
| SSE client | native `EventSource` (same-origin cookie session, no custom-header needs) | — | locked | the three channel endpoints = the 02 §1.2 table |
| virtual scrolling | not locked; `@tanstack/react-virtual` is an option when the long-transcript implementation lands | — | handed off | a performance surface, not a parity surface; decided by measurement at implementation time |

### 4.2 server (apps/server)

| Item | Decision | pin | Type | Reasoning / observed-stack note |
|---|---|---|---|---|
| runtime | Node 24 LTS; `engines >=22.19.0` (pi's floor, 00/D6); CI matrix 22/24 with 24 primary | — | inherited | carries over the old stack's argument (LTS coverage window; acceptance reds must be attributable to our own code); the official runtime is not directly observable, npm distribution + pi dependency → Node [inferred] |
| HTTP framework | Hono + @hono/node-server; SSE via the streaming helper (`streamSSE`); SPA static same-origin hosting (02/A1) | hono **4.13.8** / @hono/node-server **2.1.1** | inherited | old-stack decision carried over: first-class SSE, zod integration; **no WS library** — 02/A1 already locked all-SSE |
| DB | SQLite: better-sqlite3 + Drizzle ORM (schema-as-code + migrations into the repo) | better-sqlite3 **13.0.3** / drizzle-orm **0.45.2** / drizzle-kit **0.31.10**(dev) | locked | the official DB is a black box [designed]; perfect fit for self-hosted single machine; ⌘K search (02 §6.3 LIKE), tokenUsage accounting, and transcript queries all need a SQL surface; `node:sqlite` is still experimental (the old stack's judgment against production paths carries over); Postgres is too heavy for single-user self-hosting |
| schema surface | = the projection of 02 §6.2 record shapes + §1.3 data ownership (table list §6) | — | inherited | fields are the contract; the schema invents no new shapes |
| git server side | `GitOps` wrapper spawning the system git: `git http-backend` (CGI env + stdio pipes, the hosted-repo remote URL shape = 02 §3) + bare-repo tree-reading/single-file (`ls-tree`/`cat-file`, serving the `tree?ref=`/`file?path=&ref=` endpoints) | — | locked | the precondition "system git ≥ 2.x" goes into the install docs; isomorphic-git is out (no http-backend/worktree surface); simple-git does not cover enough and still needs raw spawn, an extra pin with no payoff |
| keys at rest | `SecretBox`: node:crypto **AES-256-GCM**; keyfile = `crypto.randomBytes(32)` base64, mode 0600, generated on first start (02 §8 already locked "no external KMS / no passphrase derivation"); envelope = `v1` version header + iv + ciphertext + authTag; encrypted objects = provider keys, team secret values, git credentials; apiKey/machine tokens are stored as hashes, not in SecretBox (02 §8) | — | locked | a lost keyfile = existing provider keys must be re-entered — the documentation guardrail follows 02 §8's original wording |
| scheduling | `Scheduler`: cron-parser pure parsing + self-built scheduling loop (vocabulary copied from 02 §9.2: hourly/daily/weekly/once, minute marks at 00/15/30/45, tz = built-in `Intl.DateTimeFormat().resolvedOptions().timeZone`, `once` dequeues after firing) | cron-parser **5.10.1** | inherited | inherited (the croniter counterpart); scheduling semantics already locked by 02 |
| MCP server surface | the `/api/mcp` endpoint uses @modelcontextprotocol/sdk (server side); the 24-tool allowlist + key-level authorization = 02 §7.2 | @modelcontextprotocol/sdk **1.30.0** | inherited | the server half of 00/D4's thin-bridge ownership |
| validation | zod 4 (record-shape schemas land in shared, consumed by both ends) | zod **4.6.5** | inherited | old-stack decision carried over |
| config | self-built layered `Settings` (the §3 seam; zod schema + loader <200 lines); env prefix = brand slot → #44 | — | inherited | inherited |
| logging | pino + pino-pretty(dev); server structured JSON; the `daemon.log` line form lives on the daemon side (§4.3) | pino **10.3.1** / pino-pretty **13.1.3**(dev) | inherited | inherited |
| authentication | no auth library: single-user seed + auto-login (02/A2), self-set httpOnly cookie; apiKey Bearer (MCP surface) and machine-token verification = hash comparison | — | inherited | the shape is already locked by 02/A2 |
| data directory | the server data root (DB file + keyfile + bare-repo storage) path = brand slot → #44 | — | handed off | shape: a single data root; backup = copy the directory |

### 4.3 executor daemon (apps/daemon)

| Item | Decision | pin | Type | Reasoning / observed-stack note |
|---|---|---|---|---|
| distribution | pure-JS npm package: esbuild bundle single file + node shebang, installed via `npm i -g`; **no replication of platform binaries** | esbuild **0.28.2**(build) | locked | the official 275MB / 6-platform binaries (r3 §1.1) [inferred] = `tds-tunnel`(tsnet) + an anti-sleep stack — the tunnel is already fogged (02 §9.3); anti-sleep spawns a platform command table (darwin `caffeinate -i`; linux `systemd-inhibit` **[inferred]**, optional); difference note §8 |
| CLI | commander (the command surface copies 02 §5.1: `start/stop/restart/logs [-f]/logout/status/version/provider`) + @clack/prompts (the interactive registration flow, 02 §5.2 path one) | commander **15.0.0** / @clack/prompts **1.8.1** | inherited | inherited; the `provider` command is prompt copy only (r3 measured semantics) |
| supervisor | self-built: detach spawn + `daemon.json{pid,startedAt,runner}` (02 §5.3 shape) + crash keep-alive restart, ~100 lines | — | locked | the implementation form of 02 §5.1's "detached + supervisor surviving crashes" |
| execution engine | single pi engine (00/D1): `@earendil-works/pi-ai` / `pi-coding-agent` / `pi-agent-core`, AgentSession stable surface (00/D3); consumed through the `AgentBackend` seam (§5) | **0.86.0** (D6 canon; the first upgrade window #107 already honored, §9) | inherited | the official executor is built from pi 0.84.3 (r3 §1.5 plaintext) — same family and shape, pinned two notches higher |
| worktree/git | `GitOps` wrapper (sharing the seam with the server; the daemon implements the shared-defined interface): vocabulary = the full 02 §5.5 table (add -b/reused/reset --hard+clean -fd/remove --force+prune+branch -D/TTL 7×24h/projectLock/divergence guards/push per step/merge --no-edit) | — | inherited | the system-git precondition is the same as §4.2 |
| MCP client surface | @modelcontextprotocol/sdk (the daemon-side thin bridge, 00/D4): per-turn connections to authorized servers, failure degrades without blocking (02 §7.1 canon behavior), tool names `mcp__<slug>__<tool>` | same 1.30.0 | inherited | the bridge belongs to the daemon: turns run inside the daemon |
| HTTP client | built-in fetch + undici (`EnvHttpProxyAgent` honoring `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`); probe and print the proxy at startup; on proxy death keep retrying without exiting (shape faithful to r3 §1.5) | undici **8.10.2** | inherited | inherits the fetch+undici route; the retry-budget values follow the 02 §5.5 table |
| step journal | outbox/ + the heartbeat/tool/done/upload-urls/token endpoint vocabulary per 02 §5.4; persistence = files (the daemon's local state has no SQL needs) | — | inherited | 02 §1.3 data ownership already locked |
| local state | the `machine.json`/`device.json`/`daemon.json`/`daemon.log` shapes per 02 §5.3 (directory/prefix brand slots → #44); the `daemon.log` line-prefix vocabulary `supervisor/machine/step/workspace/recover/wake` copied, with a custom pino transport outputting the line form | — | inherited | the log shape = a parity surface (r3 measured vocabulary) |
| stream timeouts | `streamFirstEvent 300000 / streamIdle 480000 / streamBodyTimeout 540000` ms copied (r3 bundle verbatim) | — | inherited | already collected in 02 §5.6 |
| custom tools | the three tools `web_fetch` (≤8000 chars) / `remote_shell` / `push_branch` + memory tools (02 §4.4; r5 §6 renamed the family to `save_memory`, executed server-side via the remoteTools relay; the original `remember` name is void — M4b landed); description canon per r3 | — | inherited | host increments beyond pi's built-in tool surface |

### 4.4 shared (packages/shared)

| Item | Content | Type |
|---|---|---|
| protocol vocabulary | single source of zod schemas/TS types for the 02 §5/§6 endpoints + record shapes + SSE event vocabulary; consumed by both ends (server/daemon/web) | inherited (02/A9 canonical) |
| naming-constant table | 02 §5.8's brand slots concentrated into a constant module; renaming = one-shot replacement at #44 | inherited |
| AgentBackend seam | §5 signature; the pi implementation lands in the daemon, the interface lands in shared | locked (00/D1 handoff closure) |
| GitOps / Settings / SecretBox / Scheduler seams | interface definitions land in shared, implementations go to their respective ends | locked |

### 4.5 Toolchain

| Item | Decision | pin | Type | Reasoning |
|---|---|---|---|---|
| TypeScript | 7.0.2 across the line; ESM nodenext + strict kept in all configs | typescript **7.0.2** | inherited | #104 honored: vitest 5 / drizzle-kit 0.31 / @vitejs/plugin-react / biome coexisting with the TS 7 native compiler verified all green; the i18n gate switches to the `typescript/unstable/ast` scanner (the old JS parser API went offline with the native compiler) |
| lint/format | Biome single tool (lint+format); prettier not introduced; type checking = tsc | @biomejs/biome **2.5.14** | inherited | inherited; a replication project has no legacy-rules baggage |
| unit tests | vitest projects mode: per-package test/ colocated, aggregated by root projects | vitest **5.0.1** | inherited | inherited |
| E2E | playwright: the key flows = the full 02 §4.2 main-timeline chain (create todo → start → confirm → building → review → merge → done) + scheduled triggering + ⌘K | @playwright/test **1.63.0** | locked | the main timeline is the spine of functional parity; **pixel-diff tools are not in this volume** — the map fog "pixel-parity acceptance tooling" awaits the UI-spec split ticket to graduate (§9) |
| package management | pnpm workspaces + catalog; `--frozen-lockfile` CI gate | pnpm **12.5.1** | inherited | inherited |
| CI gates | Node 22/24 dual matrix + biome ci + tsc + vitest + playwright + engines check | — | inherited | inherited §5.2 |

## 5. AgentBackend seam signature (closing the 00/D1 handoff item; the **locked** shape, fields refinable at implementation time)

```ts
// packages/shared/src/agent-backend.ts —— the event vocabulary = 02 §5.6 pi vocabulary 1:1, no additions, deletions, or renames
export type StepEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'toolcall_end'; call: ToolCallRecord }
  | { type: 'message_update' | 'message_end' | 'message_stop'; message: MessageRecord }
  | { type: 'compaction' | 'compaction_start' | 'compaction_end' }
  | { type: 'auto_retry_start' | 'auto_retry_end'; attempt: number }
  | { type: 'steer'; text: string }
  | { type: 'done'; usage: TokenUsage }
  | { type: 'error'; error: { message: string; retryable: boolean } };

export interface AgentBackendCapabilities {
  readonly name: string;                    // 'pi'
  readonly thinkingLevels: readonly string[]; // the "thinking intensity" config surface (02 §6.2 agent shape)
  readonly oauthProviders: readonly string[]; // anthropic/openai-codex/github-copilot/xai (#34 locked subscription items)
  readonly compaction: boolean;
  readonly sessionResume: boolean;          // continue session (reused by merge rounds, 02 §4.2)
}

export interface SessionOpts {
  provider: ProviderConfig;   // kind: api_key | oauth | http (02 §5.6 config kind)
  modelId: string;
  thinkingLevel?: string;
  systemPrompt?: string;      // memory injection goes through pi's before_agent_start seam (00/D3, 02 §4.4)
  tools?: ToolSpec[];         // web_fetch / remote_shell / push_branch / remember (host increments)
  mcpServers?: McpEndpoint[]; // per-turn connections, failure degrades without blocking (02 §7.1)
  cwd: string;                // the worktree directory (02 §5.5)
}

export interface AgentSessionHandle {
  readonly events: AsyncIterable<StepEvent>;
  steer(text: string): Promise<void>;
  stop(): Promise<void>;
  usage(): TokenUsage;        // build × model × {input, output, cache-read, cache-write} (02 §6.2)
}

export interface AgentBackend {
  readonly capabilities: AgentBackendCapabilities;
  createSession(opts: SessionOpts): Promise<AgentSessionHandle>;           // new session <convId>
  continueSession(id: string, opts: SessionOpts): Promise<AgentSessionHandle>; // continue session <convId>
}
```

Seam discipline: outside the pi implementation class inside the daemon, no module may import `@earendil-works/*` (a lint rule). A second engine in the future = adding one more `AgentBackend` implementation, the event surface and capability surface unchanged (00/D1's "bolt-on, not rewrite" honored).

## 6. Storage schema surface (02 §6.2 projection, **locked** list; column details = expanded at implementation time per the record shapes)

`user` (one seed row) · `team` (one seed row, including the `plan` field shape not participating in gating, 02/A3) · `project` (repo-shape fields: hosted bare / GitHub connection, 02/A4) · `todo` (the §4.1 field table in full) · `tag` + `todo_tag` · `build` (`buildId ≡ conversationId`, CONTEXT.md) · `step` (the three step queues + journal states, 02/A6; M4a: `buildId` de-FK'd and doubling as the chief conv id `chief-<threadId>`, `kind` gains `chief`, an internal column `prompt` added = the continue-round instruction) · `message` (transcript messages/tool lines, persisted via the upload-urls round trip) · `plan` (build facet: versions v1/v2 + the Context/Changes/Edge cases/Verification cards) · `document_diff` (the source of the `documents/{id}/diff` endpoint) · `schedule` (02 §6.2 shape, the kind enum containing [inferred] words) · `notification` (02 §9.1 five-event matrix [inferred]) · `agent` (with the 6 tool switches/secrets/skills/mcpServers relation tables) · `agent_memory` (the 02 §4.4 entry set) · `skill` (including file contents, the source of the `skills/{sid}/file` endpoint) · `mcp_server` (02 §6.2 shape; **M4b write-back supplement**: the wire record keeps r3 §5.1 as-is; the stdio command/args and the http header values were not captured on the wire [inferred] → internal columns `command`/`args`/`headersCipher` added (header ciphertext via SecretBox, write-only values, `credentialKeys` = the header-name list, same family as the 02 §8 credential discipline)) · `provider` (38 presets + custom, apiKey ciphertext via SecretBox) · `secret` (value ciphertext via SecretBox, write-only) · `api_key` (hash + gitAccess/mcpAccess/toolGrants allowlists, 02 §6.2) · `machine` (02 §6.2 + presence state) · `token_usage` (build×model four-dimension counters) · `chief` (**M4a write-back supplement**: the chief record body of 02 §4.3/r5 §3.6's `GET /chief` — the persistent slots binding Agent/charter/watches/wakes; the original list only carried the two thread-surface tables and the record body had no table slot; M4a adds a single-row `chief` table, with watches/wakes as per-chief JSON columns [designed]) · `chief_thread` + `chief_message` (02 §4.3 thread surface) · `whats_new` (shape kept, content self-selected, 02 §6.1).

Migration discipline: drizzle-kit generation, into the repo, CI drift verification; **no field shapes invented beyond 02** — protocol-surface fields are the contract (02/A9).

## 7. Acceptance points (to be merged into #45 ROADMAP)

1. **engines gate**: CI runs Node 22.19+/24 dual with 24 primary (inherited).
2. **pi pin discipline**: all `@earendil-works/*` exactly patch-pinned at 0.86.0; upgrades = explicit windows that read the Breaking section (the first window #107 already honored: 0.85.1 → 0.86.0, all three Breaking entries outside the seams).
3. **seam discipline**: directly importing a wrapped dependency outside the five interface seams (AgentBackend/GitOps/Settings/SecretBox/Scheduler) = lint red.
4. **protocol side-by-side**: shared-vocabulary schema snapshot tests vs the 02 §5/§6 tables; the E2E main-timeline full chain (02 §4.2) as the spine of functional parity.
5. **pixel side-by-side**: target index = r1 (landing 41 routes + CSS/font originals), r2 (19 routes, 63 screenshots); the diff tool belongs to the fog ticket; this volume only locks "the side-by-side obligation exists".
6. **i18n layered acceptance**: landing four languages page-by-page against r1 `i18n-*.txt`; docs en/zh-CN; workspace zh-CN canon entry-by-entry against the r2/r3 copy tables.
7. **PWA byte-level**: manifest/sw.js diffed against the r1 capture originals = brand-slot differences only.
8. **notifications/OS popups**: one real run per kind (carrying over 02's attached acceptance hints).

## 8. Difference-note aggregate (honoring the S1 obligation: decision vs observed stack)

| Surface | Observed | Decision | Nature |
|---|---|---|---|
| landing framework | Next.js App Router SSG | Vite SPA (same app as the workspace) | **Difference**: the official dual-stack heterogeneity → the replication unifies on a single SPA; no SEO demand, SSG not preserved |
| workspace framework | RNW/Expo [inferred] | React 19 + Radix + Tailwind | **Difference** (already locked by 00/D5); RNW not replicated |
| landing CSS | Tailwind 3.4.19 | 4.3.3 (#106 window, §4.1) | same stack across a major version: class-name semantics / five breakpoints / shadow side-by-side obligations unchanged, full-matrix re-verification |
| theme/palette/fonts | dark-default `.light` inversion, zinc/stone/indigo, Inter+JBM, no CJK webfont | copied item by item (§4.1) | same stack |
| realtime surfaces | all SSE, no WS | same | same stack (02/A1) |
| executor distribution | npm -g 275MB, 6-platform binaries | pure-JS npm package | **Difference**: the binary stack [inferred] = tunnel/anti-sleep; the tunnel is fogged, not replicated |
| executor engine | pi 0.84.3 | pi 0.86.0 (D6 pin) | same family, pinned two notches higher |
| runtime | Node [inferred] | Node 24 LTS | near-same stack |
| DB / server framework / state library / markdown stack | not observable | SQLite+Drizzle / Hono / TQ+Zustand / streamdown | **[designed]**: nothing to compare against; acceptance walks behavior/pixel targets |
| unmatched paths | 307 → `/login?callbackUrl=` | redirect `/app` (no login page, 02/A2) | **Difference** [designed] |
| sidebar "Install App" entry | exists (r7 01/02 bottom accent pill, r7 03 rail icon; `/zh/install` route) | removed wholesale (#121 dogfood ruling); `/zh/install` goes through the unmatched-path redirect to `/app` (same line as above) | **Difference**: dogfood-driven, not official drift; the r7 baseline rows containing that pill region are judged within the §04 threshold |
| card borders / sidebar seams / horizontal scrollbar | solid card borders + 1px `--border-default` hard seams (r7 01/02 pixel probes #e1dbd2/#27272a) + horizontal scrollbar area | #123 dogfood ruling switches to the claude.ai feel: cards get a 1px low-alpha border ring + wide soft shadows (the cds alpha border / `--df-shadow-card` family), the horizontal scrollbar is double-written hidden (scrolling ability preserved); the sidebar surface is **amended by #135 ruling v2 "soft edges, no seam drawn"**: the soft shadow is deleted ("it is not floating"), the 1px `--border-default` hard seam returns to the r7 original-site value, the color scale is kept, and the top divider extends full-screen width — the sidebar team-row 43px + `.sidebar-nav` border-top and each shell's topbar border-bottom share the same y43..44 pixel row (the rail toggle 44px aligns simultaneously), and the res-topbar edge color unifies to `--border-default` | **Difference**: dogfood-driven, not official drift; the card/scrollbar surfaces keep #123's original ruling; the vertical seam's dark side returns to the r7 probe's original value (#27272a), the active pill width returns to the x8..231 probes, and the light-side seam color #e2dbd1 differs from the original probe #e1dbd2 by 1 unit (a consequence of the "reuse the board line" ruling); the full-width line is a new divergence in the expanded state (the r7 expanded sidebar has no such line; the rail-state divider aligns from y42..43 to y43..44); parity is handled per §04 (within threshold or baseline re-set with a note) |
| sidebar hover/selected color scale + ⌘K chip | r7 01/02 probes: the selected pill = `--surface-secondary` solid fill (x8..231, 32px high inset, radius 6), ⌘K = a 26×20 boxed pill (1px `--border-default`, anchored 17px from the right); no official capture exists for the hover surface | #128 dogfood ruling: the geometry returns to the official probes (hover and selected unify on the same 32px-inset pill; the ⌘K boxed pill with right anchor is restored — the replication's original implementation had been degraded by the row-content lift rule, causing overlap/clipping); the color scale switches to the claude.ai cds alpha ladder — hover = neutral-900 5% / selected = 10% (white family inverted in dark), composed over the #123 sidebar color scale; `--surface-hover` keeps the official value as the overlay/canvas-hover canon (motion.css) | **Difference**: dogfood-driven, not official drift; the selected fill color departs from the r7 solid-fill value (the geometry and ⌘K are fidelity fixes back to official); parity judged per §04 (within threshold or baseline re-set with a note) |
| segmented-control family hover + geometry | no official capture exists for any segmented-family hover state (same shape as #128); r2 24b/24c · r3 92 · r7 12/16/16d/31/37 probes: the group = a 1px hairline ring + ~2px padding, chips inset (page-tab family group height 30, detail tab group 68×28 ring+plate, user-menu seg ~20px boxed cells); the replication's prior state: page-tab family chips flush with the group edge (frayed), freq dark active = `--surface-elevated` same as the container (selection invisible), detail group 64 wide with no ring, team group with no ring, user-menu seg 18h/6pad | #138 dogfood ruling: the whole family gets the `--seg-hover` cds alpha ladder at 5% (white in dark / warm ink in light, same shape as #128), with the hover riding the same box+radius as the active chip (one geometry, two depths; the selection keeps its own fill under hover); the page-tab family's four groups gain the hairline ring (border 1 + padding 2 → chips inset 3); detail-tabs return to the r7 16/16d probes' 68×28 ring+plate (`--tab-group-bg` light transparent→#faf7f3, both tabs on the same plate, active ink only); team-layout gains the ring border, chips unified into one family token; user-menu seg returns to the probes' 20h/8pad/2px gap; freq/res active unify on `--tab-chip-bg` (fixing the dark-invisible selection + canonicalizing light #faf7f3, r3 92 / r7 31 probes); `--seg-container-bg`/`--seg-tab-active-bg` merge into `--surface-secondary`/`--tab-chip-bg` | **Difference**: dogfood-driven, not official drift; the hover is a replication-side addition (no official counterpart, registered under the same wording as #121/#128); the geometry surfaces are probe-based fidelity fixes; parity judged per §04 (within threshold or baseline re-set with a note) |
| account/team local-first cleanup (#148) | account r7 13: avatar row with `更换`/`删除` + a `退出登录` box, the push-notification switch permanently on; team r7 12: the right-slot `设置` link has no behavior, the grid\|chart tablist has no behavior (r2 §8.1: the chart layout measured at 17c = the whole content block replaced by `暂无成员`, the stats bar and `创建 Agent` no longer rendered, persisted under the key `tds.teamMembersLayout`) | #148 ruling (the ledger #136 account/team row, same family as the #129 SaaS-surface deletion precedent): `退出登录`/`删除` removed (no such semantics for a local single user); `更换头像` stays as a wontfix placeholder (static assets, no upload surface); the push-notification switch connects to the real `Notification.permission` (sharing useNotificationPermission with the #114 guide bar; an off click goes through requestPermission() to guide enabling; fixture mode freezes granted to keep the r7 13 baseline); the team `设置` links to `/app/account` (the app's only settings surface, always reachable, keeping the r7 12 ink); grid\|chart becomes a real switch persisted under the already-registered key `pacman.teamMembersLayout`, with the chart layout replacing the content block by the 17c `暂无成员` empty state and hiding the stats bar and `创建 Agent`; `创建 Agent` is a TODO note deferred to the popover family's follow-up ticket | **Difference**: local-first-ruling-driven, not official drift; the tablist dual layouts are kept (17c measured no tablist — a switch with no loop-back is a trap, [designed]); the switch's off-state geometry and the `暂无成员` centering are [designed] (no official counterpart); parity judged per §04 (within threshold or baseline re-set with a note) |
| chief composer row three buttons + panel interactions | r5 100/111/114/116: the composer row's send button is flanked by `语音输入`/`添加附件`/`提及`; the fullscreen state (`tds.panel-maximized`, r2 §9-26) has no capture in any batch; the ×4 quick prompts and the Esc-close-panel behavior are unobserved | #146 dogfood ruling: voice/attachment/mention have no backend surface under local-first — **hidden, not rendered** (wontfix, the reason registered in the #136 ledger comment); "fullscreen" switches the panel form (`.is-fullscreen` fills the positioning container, radius zeroed, geometry [inferred]); Esc closes the panel (same popover-family rule as useEscapeClose, the thread-switcher inner layer closes first); the ×4 quick prompts click-send preset phrases into the chief thread (the live surface onSend); "new topic" falls back to the new-thread view | **Difference**: dogfood-driven, not official drift; all chief parity rows are smoke rows (self-comparison SSIM=1.0, no baseline threshold), and the three-button reduction is not judged negative; the fullscreen geometry has no counterpart [inferred] (registered in r8-chief-panel-adhoc §3) |
| scattered dead buttons + feedback page (#149) | the feedback page exists (r2 32); the scattered dead buttons found in the #136 ledger's live-machine sweep: the board-guide topbar button, `导出`, the `查看文档` empty-state button, the main-branch chip, the `文件`\|`历史` segmented control, and the doc-pane `变更▾` type selector all have no behavior | the feedback page is removed wholesale (local-first: no object for a SaaS feedback channel, same family as #129; the old route redirects to `/app` via the unmatched-path rule, the user-menu `反馈` row is removed with it, and the menu shrinks 272→244); the `导出` / `查看文档` buttons are all removed (wontfix: no export backend surface / no docs site to link); the branch chip is staticized **[designed]** (the hosted read surface fixes defaultBranch, the chevron keeps the r2 07e captured shape, a non-interactive element); the board-guide popover + the `变更▾` type selector connect to the anchored-overlay family rules (#67/#127: OverlayMount + ClickCatcher + Esc), with the popover content **[designed]** (the official guide surface has no capture; the content-self-selection precedent = whats-new: the COLUMNS semantics single source + gate operations + ⌘K); the history surface = **[inferred]** commit-read surface `GET /api/projects/{id}/commits` (not captured on the wire, registered in INFERRED_ROUTES; the runGit direct-call precedent = readBuildChanges; the line form [designed] = a minimal projection of git log, non-hosted = 404 like the tree/file family) | **Difference**: dogfood-driven, not official drift; the user-menu losing one row shifts the pixels of the containing-menu baseline rows (16d/17/26d/27d + the #127 trigger family), judged within the §04 threshold (the local thinnest 0.858/0.84, same precedent as #121's pill removal without baseline re-set); the guide popover / history surface / type-selector open state are replication-side new divergences (no official counterpart), pinned by parity smoke rows (expectText) |

| voice-input button | exists (r2 toolbar), implementation not observed | Web Speech API [inferred] | shape parity, best-effort behavior |

## 9. Handoffs and watch items

| Item | Destination |
|---|---|
| icon-glyph extraction (capturing the workspace bundle/SVG in logged-in state), font woff2 and bitmap-icon downloads, the emoji common-grid subset, PWA brand-slot replacement | **#44 asset checklist additions** |
| pixel-diff acceptance tooling and per-screen UI-spec splitting | landed: #53 built the parity harness; the acceptance-rules canon = volume 04 §2 (this volume's §7.5 side-by-side obligation honored) |
| pi 0.86.0 upgrade-window evaluation (reading the Breaking section) | landed: #107 honored the first D6 window — all three Breaking entries outside the seams (zero absorption points inside the seams), pinned 0.86.0 (§4.3) |
| framework upgrade tickets (TS 7 / Tailwind 4 / react-router 8) | all landed: TS 7.0.2 (#104, §4.5), Tailwind 4.3.3 (#106: + the `@theme inline` token layer + `@custom-variant dark`, full matrix of 174 lines 0 failures, §4.1), react-router 8.4.0 (#105, §4.1); the cadence = volume 03 §3 (after M6) |
| turbo introduction | triggers when CI duration becomes a pain point (inherited) |
| transcript virtual scrolling (@tanstack/react-virtual candidate) | decided by measurement at implementation time, not pre-locked |
| `preview-token`/`tds-tunnel` | recorded but undesigned in 02 §9.3; trigger condition = volume 04 Appendix B |
| daemon anti-sleep linux path (`systemd-inhibit` [inferred]) | measured per platform at implementation time |

## 10. Impact on downstream tickets

- **#45 ROADMAP**: completed (2026-09-22) — §7's acceptance points merged into volume 04; §9's upgrade-window/upgrade-ticket cadence assembled into volume 03 §3; the build order follows §3's package split into volume 03 §2 (two parallel lines, backend segment shared → server → daemon → orchestration).
- **#44 release and assets**: §9's four asset-checklist additions; 02 §5.8 + this volume's brand slots (localStorage prefix, env prefix, data directory, package name) form the complete one-shot replacement surface.
- **#42 prototype two-screens**: the frontend stack is exactly this volume's §4.1 (React 19 + Tailwind 3.4.19 + Radix + TQ); the prototype can start directly against the pin table.
- **#46 Chief experiment**: Chief = a pi session with team tools attached (02 §4.3), running on the `AgentBackend` seam; experiment outputs are written back without changing this volume.
