# 11 · Model Service and Machine Localization

> **superseded-in-part (2026-10-08, ADR 0012 / #980 / #1013 supplement)**: on top of the notes above (#908 overhaul / #953 term-state reconciliation), two more voided surfaces — ① the **carrier-shape** surface of the header's "upstream reference = todos.dev's current shape" and A6's "rework create-provider-dialog.tsx into the upstream shape": "upstream" re-anchors in the component-shape semantics — the `components/ui/` carrier shape takes the registry upstream base-nova default as the sole canon (ADR 0012 D1/D3, zero-skin adapter layers), and the todos.dev reference is demoted to page-semantics / structure / behavior input (the semantics surface stays valid); ② the note above's "new canon pointer: ADR 0010, docs/spec/22" pointer is voided — ADR 0010 D2's component-level geometry authorization is partially revoked and spec/22's component-level sections are superseded-in-part, the shape-surface canon chain = **ADR 0012** + the #982/#983 ruling tables + the #991 batch table (execution already landed on main: #1003 registry re-pull PR #1045, #1005 resources-domain alignment PR #1057). Page semantics and structure, acceptance behavior, and the daemon/server surfaces remain canon (continuing the note above's caliber).

> **superseded-in-part (2026-10-07, #908 site-wide UI overhaul / #953 term-state reconciliation)**: this volume's "implementation landing" section web carrier pointers — `resources.css` (or a new `providers.css`) — are voided by the wholesale per-face CSS zeroing (#944 resources-domain execution; the carrier layer keeps only the five whitelist items, styles = Tailwind utility classes on shadcn components). Page semantics and structure (runtime tablist, header card, model rows, picker shape), acceptance behavior and the daemon/server surfaces are **unaffected**, still canon. New canon pointer: ADR 0010, docs/spec/22. The original text is kept wholesale as the historical ledger, not deleted.

> Scope: the `/app/resources/providers` and `/app/resources/machines` two pages localized rewrite. Covers the two facade remnants of the r3 replication (the providers `Pacman（内置）` row and the machines `Pacman 托管机器` row — both fixed frontend-rendered decorations, not repo data); the page semantics flip to: pacman provides no remote model/machine service, but can connect an external remote provider and same-network machines.
>
> Upstream reference = todos.dev's current shape (measured under login 2026-09-28): the providers page is a runtime tablist (pi / Claude Code / Codex), inside each tab = a header card (runtime description + installed on <hostname>) + model rows (slot → actual model id); the machines page = hosted rows + a local-machine row (with real per-runtime switches) + add machine. This spec takes its structure and drops its hosted semantics.

## Problem Statement

1. **providers-page semantic mismatch**: the page feeds the 38 remote provider preset catalog as a built-in picker (`providerPresets()` + `PROVIDER_PRESET_IDS`) and renders a `Pacman（内置）` facade row at the top of the list. pacman is local-first and provides no remote model service itself — the page promises a product surface that does not exist.
2. **machines-page semantic mismatch**: it likewise renders a `Pacman 托管机器` facade row (not enabled). The hosted shape does not exist in this architecture; what the user really owns is the local machine + self-onboarded LAN/VPS machines.
3. **misleading row clickability**: both pages' resource rows render `RowChevron` / `EllipsisVertical` / `StatusPill` decorations, but the `<div class="res-grow">` rows have no click handler (#222/#231 charge-off notes: no backend surface, no dead buttons). Measured (verify-stack per-button probes): both pages' real buttons (`.res-new` / `.res-add`) are clickable with no overlay occlusion — the user's "button unclickable" report is actually decorational misdirection.
4. **configuration source not automated**: the upstream Claude Code tab directly shows the local machine's `~/.claude/settings.json` model-slot mapping; pacman's model list currently comes only from user manually entered custom providers, with no local auto-discovery.

## Solution

| ID | Decision | Landing shape |
|---|---|---|
| **A1** | providers page switches to the runtime-tab shape | tablist = `pi` / `Claude Code` two tabs (no "built-in" wording; Codex expanded by a later ticket). The page no longer renders the `Pacman（内置）` facade row |
| **A2** | tab content contract | each tab = header card (runtime name + one-line description + `已安装在 <hostname>`) + model-row list (display name → model id). Rows without a handler render no chevron/three-dot (absorbs the row-clickability fold-in, see A7) |
| **A3** | pi tab data source = custom providers | pi is pacman's own runtime (the daemon-routed local model source surface); its available models = the `models[]` of the custom providers the user configured via `添加服务商`. With no custom provider, the empty state guides to the picker. The pi probe/not-installed state goes to the implementation ticket to pin |
| **A4** | Claude Code tab data source = execution-machine report, server aggregates per machine (#707 revision; #1050 adds the binary and credential bits) | the daemon reads the local `~/.claude/settings.json` (`model` field + `env.ANTHROPIC_*_MODEL` slot overrides, slot semantics unchanged), carried up on the presence 30s beat + enroll; the server aggregates per machine (a pi first segment + one claude-code segment per machine that has ever reported, sorted by machine name, order fixed). Machines that never reported are absent, no fake list is sent; a missing/unparseable file reports `installed:false`, no empty report, no crash. From #1050 the same segment carries two more fact slots: `bin` (`{path, version}`, the daemon probes the local claude binary: PATH resolution + `claude --version`, 2s cap) and `auth` (the `claude auth status` precheck three-state, backfilled within the step). **The `bin` three states do not merge**: the object = probed present; `null` = probed absent; key absent = not yet probed (old daemon). The header-card main-sentence criterion priority = binary > config file: config file present but binary gone says `未安装` (kills the old behavior's false green), binary present but no config written says `已安装，未配置模型槽`, key absent falls back to the old installed-only behavior. From #1845 the same beat carries `login` (`ok`, `expiring`, `expired`, or `unknown`, plus `expiresAt` when the local Claude Code credentials file has `claudeAiOauth.expiresAt`). `claimStep` does not give `claude-code` steps to a machine whose login is `expired` or whose `expiresAt` is already past. `unknown` does not block. The machines page warns when expiry is within 3 days or already past, and names `claude auth login` |
| **A5** | the 38-preset data layer stays fully, the page layer yields | `PROVIDER_PRESET_IDS` / `PROVIDER_OAUTH_PRESET_IDS` / `PROVIDER_XAI_PRESET` / `providerPresets()` / the OAuth authorize chain (#231/#243 landing surfaces) all kept. The `新建` button now opens the picker dialog (A6); presets appear only inside the dialog |
| **A6** | add-provider picker dialog | rework `create-provider-dialog.tsx` into the upstream shape: a search box + 38 preset rows (OAuth family with badge) + a bottom `自定义端点` entry (expands the existing custom-gateway form). Clicking a preset row → OAuth family goes through the existing authorize redirect, api_key family enters that preset's key form |
| **A7** | row-clickability fold-in | resource rows render `RowChevron` / `EllipsisVertical` only when a real handler (navigation/menu) is mounted; pure display rows render no clickable decoration. This rule lands with the two-page rewrite, not as a separate patch ticket |
| **A8** | machines page = local-machine baseline + registered machines | delete the `Pacman 托管机器` facade row. The local-machine row is always first and not deletable: the server startup seeds (or the daemon's loopback enroll lands `kind='local'`). Each row carries real per-runtime switches (pi / Claude Code). The add-machine flow is unchanged (CLI command dialog: `pacman start` / `--api-key` / browser authorize three paths already in place), LAN/VPS = run the same CLI on the target machine |
| **A9** | machine schema adds two columns | `kind: 'local' \| 'remote'` (default `'remote'`, loopback enroll lands `'local'`) + `enabledRuntimes: string[]` (JSON, the UI switch writes here). **#682 revision**: from the claim real gate, the seed/enroll default and existing-row backfill = `['pi']` (`[]` all-off = a fresh machine cannot claim anything, bootstrap must not idle; claude-code remains opt-in) |
| **A10** | chief-model-select data-source switch | the option list = the union of the A3/A4 two runtimes' models + custom providers `models[]` (current logic kept). The preset bare-string fallback logic retires — after the page no longer feeds the 38 presets, the unmatched option's echo still goes through the bare string (#180 ruling unchanged). **superseded-in-part (#1288): the pi/relay segment (relay /v1/models liveness catalog) re-enters the selector candidates — A10's original "own relay not wanted" ruling is overturned; selector candidates = claude-code slot segment ∪ the relay full catalog, deduped across families by model id (liveness takes the strict side). The spec source of truth sees docs/research/r16-model-catalog-liveness.md.** |
| **A11** | i18n syncs with the ticket | the new Chinese copy syncs `apps/web/src/i18n/en.ts` in the same PR (the i18n-coverage gate), no separate ticket |
| **A12** | verify feature map first | the T0 ticket first expands `.claude/skills/verify-pacman/features/` (providers tabs / machines local-machine row / picker dialog three surfaces), the implementation tickets consume it; web spec + integration locator + visual geometry assertions sync with the implementation tickets (the four pinned surfaces) |

> #774 receipt fallback (2026-10-04): the chief main-model slot's existing value is not among the current candidates (the local model changed) → the server nulls it at receipt time (inherit the bound Agent = picker default row) before enqueueing, and the response carries back the original value for an explicit client toast (the user ruled no silence). The custom-provider existing value (no corresponding segment) stays untouched — the execution surface still resolves the original value; the candidate surface has no right to rule.

### Upstream 38-preset display names (measured 2026-09-28, picker copy source)

`PROVIDER_PRESET_IDS` is 1:1 equal in count to the upstream list (38). The dialog-row display names take this list as canonical (the OAuth badge family = the two `PROVIDER_OAUTH_PRESET_IDS` entries + xAI's oauthLabel shown inside its key form):

```
Amazon Bedrock, Ant Ling, Anthropic, Baseten, Cerebras, Cloudflare AI Gateway,
Cloudflare Workers AI, DeepSeek, Fireworks, GitHub Copilot (OAuth), Google,
Google Vertex AI, Groq, Hugging Face, Kimi For Coding, MiniMax, MiniMax CN,
Mistral, Moonshot AI, Moonshot AI CN, NVIDIA, OpenAI, OpenAI Codex (OAuth),
OpenCode Zen, OpenCode Go, OpenRouter, Qwen Token Plan, Qwen Token Plan CN,
Qwen Token Plan Individual, Together, Vercel AI Gateway, xAI, Xiaomi,
Xiaomi Token Plan AMS, Xiaomi Token Plan CN, Xiaomi Token Plan SGP,
Z.AI, Z.AI Coding CN
```

> #385 revision (2026-09-29): `openai-codex`'s OAuth family is not wired server-side (`OAUTH_FAMILIES` has only github-copilot; the A5 family table stays), so the upstream list's `(OAuth)` suffix **is not rendered** for that row in this picker — the row is disabled + a right-side `暂未开通` note, clicking does nothing (no more authorize 404). The badge only rides the wired families in the family table (now only GitHub Copilot); the other 37 rows render consistent with the list.

## User Stories

1. As a user, I open the model-service page and see the `pi` and `Claude Code` tabs, each tab header saying which machine it runs on, so that I know the models come from local-machine configuration rather than some remote hosted service.
2. As a user, I see in the Claude Code tab the model-slot mapping consistent with my local `~/.claude/settings.json` (default → …, opus → …) without manual entry.
3. As a user, I click `新建` and see a searchable provider list (with OAuth badges) and a bottom custom-endpoint entry, so I can connect an external remote provider into the pi runtime.
4. As a user, I open the machines page and see the local machine first with runtime switches, so I can decide whether the local machine runs pi or Claude Code tasks; when adding a LAN machine or VPS, the dialog gives me a copyable CLI command.
5. As a user, I no longer click on a three-dot icon or a `>` arrow and get nothing — rows without an action grow no clickable decoration.
6. As a reviewer, I see the chief compression-model selector's options come from the runtime model list and custom providers truth, and after the page hides the 38 presets the chief echo is neither empty nor crashing.
7. As a regression tester, I see the verify-pacman feature map expanded before implementation, and the implementation tickets' web spec / integration locator / visual geometry sync flip red-to-green with evidence entering review.

## Implementation Decisions

### Module change list

**shared**
- `packages/shared/src/records/machine.ts`
  - `machineRecordSchema` adds `kind: z.enum(['local','remote'])`, `enabledRuntimes: z.array(z.string())`
- `packages/shared/src/records/provider.ts`
  - unchanged (the 38 constants all kept, A5)
- new `packages/shared/src/records/model-source.ts` (name negotiable within the ticket)
  - runtime-tab envelope schema: `{ runtime: 'pi' | 'claude-code', installed: boolean, hostname: string, models: { id, name, slot? }[], bin?: { path, version: string|null } | null, auth?: { state: 'logged-in'|'not-logged-in'|'unknown', method?, provider?, reason? } }` (`bin`/`auth` are the #1050 increment, optional)

**server**
- `apps/server/src/db/schema.ts`
  - the `machine` table adds `kind` (text, default `'remote'`) + `enabledRuntimes` (JSON text, default `[]`)
  - from #707 adds `claudeCodeReport` (JSON, nullable: `{installed, hostname, models[], bin?, auth?}`, the daemon report verbatim; `null` = never reported; #1050's `bin`/`auth` are optional increments, add columns without a migration)
- `apps/server/src/services/machines.ts` (or a new module)
  - server startup seeds the local-machine row: `os.hostname()` matching an existing row backfills `kind='local'`, otherwise creates the row (idempotent); the daemon loopback enroll follows the same rule
  - `PATCH /api/machines/{id}` (or a new endpoint within the existing machine-route family): writes `enabledRuntimes`, the body schema lands in shared
  - #707: `enrollMachine` / `markPresence` persist the `claudeCode` report into `claudeCodeReport` (absent = old daemon, keep the old value)
- `apps/server/src/services/providers.ts`
  - `getProvidersEnvelope` unchanged; `getModelSources(deps, teamId)`: pi segment = custom providers `models[]` projection; claude-code segment = one segment per `machine`-table row that reported `claudeCodeReport` (#707; the server does not read the local `~/.claude/settings.json`)
- `apps/server/src/routes.ts`
  - `GET /api/teams/:id/model-sources` (next to the providers route, the 1334-line family)

**daemon**
- `apps/daemon/src/claude-code-models.ts` (#707): `readClaudeCodeReport()` reads the local `~/.claude/settings.json` (the single source of slot semantics = shared `parseClaudeCodeModelSource`, consumed by both server and daemon; missing/invalid → `installed:false`, no throw)
- `apps/daemon/src/machine-loop.ts` + `machine-client.ts` (#707): enroll and every presence (30s) carry the `claudeCode` report; small payload, no new long connection

**web**
- `apps/web/src/resources/providers-page.tsx` + `resources.css` (or a new `providers.css`)
  - whole page rewritten to the tablist shape: tab state goes into the search param (`?runtime=pi|claude-code`, refresh/share re-locatable)
  - header-card component + model-row component; from #707 the claude-code tab segments by machine (one header card + model rows per machine that reported; zero segments = an honest empty state); handler-less rows render no `RowChevron`/`EllipsisVertical` (A7)
  - empty state: the pi tab with no custom provider guides to opening the picker
- `apps/web/src/resources/create-provider-dialog.tsx`
  - reworked into a picker: search box (client-side filter of 38) + preset rows (name list above; OAuth family badge) + a bottom `自定义端点` disclosure expanding the existing form
  - the OAuth branch logic (`onConnect` / `#231` error row / `#243` three-way reason translation) kept verbatim
- `apps/web/src/resources/machines-page.tsx`
  - delete the hosted facade row; the local-machine row (`kind='local'`) pinned first + not deletable; runtime switch component (`role="switch"`, PATCH writes `enabledRuntimes`)
  - `CreateMachineDialog` structure unchanged (the CLI command is the truth)
- `apps/web/src/chief/chief-model-select.tsx`
  - the option data source switches from the providers-envelope projection → `GET model-sources` projection + custom-provider union (A10)
- `apps/web/src/api/hooks.ts` + `mappers.ts`
  - `useModelSources` query + mapper; `useMachines` adds the PATCH mutation
- `apps/web/src/fixtures/`
  - the fixture surface adds runtime-tabs / local-machine-row scenario data (fixture rule: canonical display when no live)

**i18n**
- `apps/web/src/i18n/en.ts`: sync the English entries of new copy with each implementation ticket (A11)

**verify / e2e**
- `.claude/skills/verify-pacman/features/`: T0 first expands the three surfaces (providers tabs, machines local-machine row + switches, picker dialog)
- `apps/web` e2e specs + integration locators + visual geometry assertions: sync with T3/T4 (the four pinned surfaces; missing any of them reds CI but stays locally invisible)

### Data contracts

- `GET /api/teams/:id/model-sources` → `{ sources: [pi segment, ...claude-code segments] }` (#707: pi always the first segment + one claude-code segment per machine that reported, sorted by machine name, order fixed; the element schema single-sourced in shared)
- `PATCH /api/machines/:id` body: `{ enabledRuntimes: string[] }` (element vocabulary = `'pi' | 'claude-code'`, shared constant)
- the providers existing envelope `{ presets, providers }` unchanged; the picker dialog consumes the `presets` segment

### Ticket draft table (/to-tickets split-ticket base)

| Ticket | Content | blocking |
|---|---|---|
| T0 | verify-pacman feature map expands the three surfaces | — |
| T1 | shared schema + machine two-column migration | — |
| T2 | server: model-sources endpoint + machine PATCH + local seed | T1 |
| T3 | web providers-page rewrite (tabs + picker dialog + A7) | T0, T2 |
| T4 | web machines-page rewrite (local row + switches + A7) | T0, T2 |
| T5 | chief-model-select data-source switch | T3 |
| T6 | e2e/visual pin sync + verify evidence wrap-up | T3, T4 |

T0 ∥ T1 parallelizable; T3 ∥ T4 parallelizable; T5, T6 serial at the tail.

### Known boundary: multi-machine rotation session affinity (registered after #682 lands, for later multi-machine tickets to cite)

- **conv session files are execution-machine-local assets**: pi's sessionDir and claude-code's session files both live on the claiming machine's disk and do not travel with git — a worktree and conv branch are recoverable from origin by any machine, **the conversation context is not**. When machines rotate to claim the next step of the same build, the daemon-side SessionNotResumable degrades to a new session (the task continues, but the agent re-reads the problem and loses prior accumulated context).
- **machine affinity is therefore a correctness item, not an optimization**: from #682 a worker build pins by `build.pinnedMachineId` (the task-level entry = `todo.machineId`, wired through the three entries — new-task machine chip / REST body / chief `run_builds`, the schedule explicit value wins), the chief thread pins by `chief_thread.pinnedMachineId` (the orchestration entry lands from the todo value); the claim filter ensures only that machine can claim once pinned.
- **unpinned (null = auto) guarantees no affinity**: any online machine FIFO-preempts, and rotation degrades to a new session — invisible in single-machine self-use (this spec's target shape), but multi-machine teams must pin per task.
- **session migration is explicitly not done**: moving session files with the step payload requires first untangling the in-file local path/credential coupling, no ticket now; open one when needed (citing this section).

### Model fallback chain and provider circuit breaker (#1493)

The caliber source of truth = the #1493 comment "implementation caliber". Landing essentials:

- Config: `agent.fallbackModels`, ordered, max 5; `null` / `[]` = never switch models ("an explicitly specified model does not fall back").
- Plan / build steps can switch models. Chief turns can switch to a configured backup within the same runtime (#1938). Review / verify / merge conclusions feed the merge-readiness gate (ADR 0021); these three never switch.
- Triggers: quota exhausted (quotaBlock kind=quota or text classification quota), model 404, auth failure (401 / invalid key), provider 5xx / account exhaustion, exhausted provider-network retries, and rate limiting (quotaBlock kind=capacity or text classification capacity). Plan and build steps switch; chief turns stay within the same runtime. When the chain is exhausted, quota and rate limits fall back to the quota-wait funnel; a provider outage or network failure with no model left fails the step. An agent with no fallback list never switches.
- Provider-network retries (#1786): plan and build steps retry the same model and session after 2s, 4s, 8s, and 16s, even when the backend marks the error non-retryable. This includes `Connection error.`, `ECONNRESET`, `socket hang up`, and `fetch failed`, whether emitted as an error event or thrown by the stream. Exhausting all five attempts reports failure to the server, which advances to the next configured fallback. Each fallback receives its own retry budget.
- Picking the fallback: in config order, skipping the models already tried in this step, those whose owning machine has the runtime turned off, dead models, and providers with an open circuit breaker. When the chain is exhausted, it falls back to the original funnel (quota → quota-wait; 404 / auth → failure funnel), stopping at the last model without wrapping back to the primary.
- Execution: the same step returns to pending with `freshSession` (no cross-provider session continuation, the brief re-injects from a new session), `step.fallback` records the current model and the tried list; the claim payload and per-step credentials are issued by `step.fallback.model`, so `token_usage` is billed per the actual model. The conversation stream lands a system row and emits a `model_fallback` in-app notification.
- Circuit breaker (`services/provider-health.ts`): 3 consecutive failures → degraded, 5 → open, open for 30s → half_open admits one probe step (probe lease 10 minutes); success back to healthy, failure back to open with a fresh count. Counted as consecutive failures are quota-empty, rate-limit, auth, provider-outage, and exhausted provider-network failures. **The state lives only in server process memory**: after a restart everything starts from healthy, worst case one extra try on a known-bad provider. The breaker is only used to pick a fallback; it never proactively sidesteps the primary before the primary fails.
- 0-token silent success: a plan / build step reports success, reported usage with all rows input+output 0, and no changes → retry once with a new session on the same model; once more and it closes as a failure. Unreported usage is not judged.

### Custom model context-window and output-cap declaration slots (#1526)

- `providerModelSchema` adds optional `contextWindow` / `maxTokens` (positive integers). Chain: provider row (POST/PATCH providers body) → DB JSON column → per-step credential issue (`machineTokenResponseSchema`, zod strips unknown keys by default, so the schema slot is wire-required) → daemon `materializeProvider`, when materializing the models.json entry, the declared value overrides `CUSTOM_MODEL_DEFAULTS` (128k context / 16k output); undeclared keeps the default same-shape, zero regression.
- 1M-context models (glm-5.3 etc.) are no longer prematurely capped at the 128k default, and output no longer truncated at 16k. The API surface is configurable; the provider page has no edit surface, model-row editing is not in this ticket.
- Criterion: `apps/daemon/test/pi-config-effect.test.ts` (declared 1_000_000 → models.json entry contextWindow=1_000_000; undeclared → 128k/16k same shape; two models of the same provider do not cross-contaminate) + `packages/shared/test/records.test.ts` (schema passthrough, rejects 0/negative).

## Verification

- Each ticket's wrap-up runs the corresponding verify-pacman feature (the surface T0 expanded), evidence (screenshots/JSON) archived with the PR
- The local three gates (`pnpm lint` / `pnpm format` / `pnpm typecheck`) + the relevant e2e entries (never run the full set during development)
- i18n-coverage goes through the CI full `pnpm test` gate
- drizzle migration numbering collision: renumber to main's tail +1 at merge time