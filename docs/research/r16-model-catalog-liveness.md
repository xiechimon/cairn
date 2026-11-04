# Model selection surface: upstream full catalog + liveness state — phase-1 research and spec draft (entered the repo with PR #1288)

> Target issue: #1288 (OPEN). This file was originally a read-only research artifact and has entered the repo with the #1288 implementation PR (docs/research/r16-model-catalog-liveness.md) — the full-chain data-flow evidence / options A/B/C comparison / 10 failure modes / spec skeleton are the decision canonical copy at kickoff time; implementation followed the three gates on the ticket.
> Related in-repo tickets: #1287 (alias resolution and dedup, in progress, touching `packages/shared/src/records/model-source.ts`).
> Background (measured): a claude-code machine offers at most 5 models, one per slot mapped in `~/.claude/settings.json`. The upstream relay (provider row relay-186, baseUrl `http://<relay-host>:<port>`, apiKeyCipher in SecretBox) serves 9 models from `GET /v1/models`; two of them, `deepseek-v4.1-flash` and `gpt-5.6-luna`, were withdrawn upstream (`/v1/messages` 404), yet the UI still lists them, while `homeMachineRejectReason` rejects live models outside the list with a 400.

---

## 1. Current data flow (where a model id comes from, how many hops it passes, where dedup/filtering happens)

### 1.1 Two model families with sources, never merged

**Family A — provider-table models (pi section / custom provider)**
- Storage: the `provider.models` column, `json<ProviderModel[]>`, in plaintext (`apps/server/src/db/schema.ts:475`).
- The `ProviderModel` shape = `{ id, name, cost? }` (`packages/shared/src/records/provider.ts:31-36`) — **manually entered by the user**, not probed (a comment explicitly says `// 探测模型 对 /v1/models 拉列表 (r3 §2)`, but there is currently no probing implementation; the column only has a write surface).
- relay-186 is a member of this family: `baseUrl` + `apiKeyCipher` (sealed with SecretBox) + `models[]` (a user-entered subset).
- Readout: `listProviders` → `toProviderRecord` (`providers.ts:48-62`, `models: row.models` passed through as-is).

**Family B — claude-code machine-reported models (claude-code section)**
- Source: the daemon reads the local `~/.claude/settings.json` (`model` field → the default slot; `env.ANTHROPIC_*_MODEL` → named slots), with the pure slot semantics single-sourced in shared `parseClaudeCodeModelSource` (`packages/shared/src/records/model-source.ts`).
- Daemon side: `readClaudeCodeReport()` (`apps/daemon/src/claude-code-models.ts`) assembles `{installed, hostname, models, bin?, auth?}`.
- Uplink: enroll + every-30s presence carry the `claudeCode` field (`apps/daemon/src/machine-loop.ts:288`, `:303`, `:305`; `machine-client.ts:86/93`).
- Persistence: `markPresence` overwrites `body.claudeCode` into `machine.claudeCodeReport` (`apps/server/src/services/machines.ts:494-509`, overwritten every beat).
- The ids of this family's models are actually provided by the relay (claude-code's `ANTHROPIC_BASE_URL` points at the relay, and `ANTHROPIC_*_MODEL` picks one entry from the relay catalog), but pacman's data plane cannot see the relay catalog in full — it only sees the subset mapped from the machine's slots (at most 5 entries).

**The merge point of the two families = `getModelSources` (`providers.ts:getModelSources`)**
- Produces `{ sources: [pi section, ...one claude-code section per reporting machine] }`.
- pi section: a flat projection of all custom providers' `models[]` from `listProviders` (empty ids dropped, empty names falling back to ids).
- claude-code section: `listClaudeCodeSources` renders one section per machine, sorted by machine name (`providers.ts:listClaudeCodeSources`).
- **Key: the two families only sit side by side in the same `sources[]` array; there is no id-level merge dedup**. A relay model in the pi section and a slot model in the claude-code section pointing at the same relay model id each occupy one row.

### 1.2 The web selector consumption chain

- `GET /api/teams/:id/model-sources` (`routes-resources.ts:396-399`) → `getModelSources(keysvc, teamId)`.
- The web's `useModelSources(teamId, live)` pulls the envelope (`providers-page.tsx:149`).
- **The providers page** (`providers-page.tsx:140-270`): the tablist = `pi` / `claude-code`; filters `matching` by `?runtime=`, rendering a header card + model rows per section. **Display only, not selectable** — rows have no click handler; it is a pure read-only catalog view.
- **The model selector** (two-level cascade on agent create/overview + the chief compact popover):
  - Candidate projection = `toModelOptions(sources)` (`apps/web/src/api/mappers.ts:1197-1224`).
  - **The current implementation only takes non-pi sections** (`if (source.runtime === 'pi') continue;`, `mappers.ts:1213`) — that is, the selector **only looks at claude-code-section machine slot models and never at the pi-section relay catalog**. This is the direct cause of #1288 problem 1 "the selector cannot see or select them": the user's ruling (in a comment) "we don't want our own relay; Claude Code surely does it better than us" removed the pi section from the selector, but the claude-code section is only a slot subset, so only 5 of the 9 are visible.
  - Dedup key = `provider/machineId/modelId` (`mappers.ts:1207`; #1259 added machineId to prevent key collisions across same-named machines), first-wins.
  - Two-level cascade (`agent-model-select.tsx`): level one = provider groups (`providerGroups`), level two = the models under that provider. Clearing level one clears level two (preventing cross-provider stale values).

### 1.3 Summary of dedup/filter landing points

| Location | Effect | Evidence |
|---|---|---|
| `toModelOptions` dedup key `provider/machineId/modelId` | selector candidate dedup | `mappers.ts:1207` |
| `getModelSources` pi-section empty-id drop / empty-name fallback | envelope hygiene | `providers.ts:getModelSources` |
| `parseClaudeCodeModelSource` empty slot values skipped | uplink hygiene | `model-source.ts` |
| `homeMachineRejectReason` model-list validation | **write gate** (see §4) | `dispatch-eligibility.ts:269-285` |
| claim surface `!agentRow.modelId` | only checks non-empty, not list membership | `machines.ts` (chief `:735`, worker same shape) |

### 1.4 Current write gate (`homeMachineRejectReason`, `dispatch-eligibility.ts:259-285`)

- Trigger surfaces: agent creation (`routes-agents.ts:87`), PATCH switching provider/model or switching the owning machine (`:181`, `:196`), whole-machine migration batch validation (`routes-resources.ts:221`). **All three share the single source.**
- Criterion: when `runtime === 'claude-code' && modelId != null`, require `report.installed && report.models.some(m => m.id === modelId)`. `report = machine.claudeCodeReport` (**only the claude-code-section slot list is checked; the pi-section relay catalog is not**).
- This is #1288 problem 3: a **live** model outside the list (such as the relay's on-shelf `glm-5.3-flash`) is rejected with a 400 — the gate blocks "not configured into a slot", not "cannot be used".

---

## 2. How the provider-table models and the claude-code-reported models currently converge (or not) in the UI

**Conclusion: they do not converge.**

- Providers page: the two families occupy one tab each (pi / claude-code), **displayed side by side without merging**. The pi tab = a flat tiling of all custom providers' models[] (tiled across providers; occasional model-id name collisions fall back to indexing, `providers-page.tsx:232`); the claude-code tab = sections per machine, each section being that machine's settings.json slot mapping.
- Model selector: `toModelOptions` **only consumes the claude-code section** (`mappers.ts:1213` skips the pi section); the pi-section relay catalog never enters the selector candidates.
- The provider.models column plaintext structure = `{ id, name, cost? }` (`provider.ts:31-36`), manually entered by the user (create/update provider form), with **no probing backfill**.

**The two families' ids are actually same-source (both from the relay) but invisible to each other on the data plane**: claude-code slot model ids are a subset of the relay catalog, while the pi-section relay provider's `models[]` was separately entered by the user (possibly stale / incomplete). The UI can neither see the relay `/v1/models` full catalog nor tell which entry is still alive.

---

## 3. Liveness-probing trade-offs (the core deliverable)

> The probing goal = obtain the relay `/v1/models` live catalog (9 entries) + annotate which are alive / which are dead (the 2 entries returning 404). The probing target is the **relay (the provider-table row, with the server holding apiKeyCipher)**, not the claude-code binary — claude-code slots are just the user's subset selection from the relay catalog, and liveness is inherited from the relay.

### Option A — server-side direct connection to relay `/v1/models` (holding apiKeyCipher)

**Mechanism**: the server calls `openProviderKey` (`providers.ts:305`, an existing SecretBox-decryption precedent) to get the relay apiKey → `fetch(baseUrl + '/v1/models', { headers: { Authorization: 'Bearer <key>' } })` → parses the returned model catalog + each model's liveness.

**Key-reach surface**: same discipline as `openProviderKey` / `openGithubToken` (`github-connection.ts:61`) — plaintext only enters memory, never touches disk, never enters logs. The server already has external-HTTP precedents (`lib/github.ts`'s `fetchImpl` + `AbortSignal.timeout` + `readJson`; `skill-import.ts`'s `fetch + GH_HEADERS`).

| Dimension | Assessment |
|---|---|
| Probing cost | One HTTP GET /v1/models (lightweight; the relay side only lists the catalog without hitting a model). Cacheable per provider. |
| Cache/TTL | Server in-memory cache; suggested TTL 60s (aligned with Multica's `cachedDiscovery` 60s, `r13:154`). The 30s presence beat is too frequent; catalog changes happen on the minute scale. |
| Failure semantics (false-kill risk) | **Medium**: a probing failure (relay down / timeout) ≠ a dead model. Must fail-open: cannot probe = mark "unknown", never grey out, and absolutely never mark a live model dead. Deadness must be confirmed by an actual `/v1/messages` 404, not by `/v1/models` omitting it — `/v1/models` may still list a model that 404s (measured: deepseek-v4.1-flash is in /v1/models but 404s on /v1/messages). **This is option A's biggest pitfall**: /v1/models gives "in the catalog" but not "callable". |
| Key-exposure surface | The server holds plaintext going outbound once per cache period. The key never leaves the server process (not onto the wire, not into logs), same discipline as the existing github/oauth outbound calls. |
| Relationship with #1287 | **No conflict**. #1287 changes `parseClaudeCodeModelSource` (claude-code-section alias resolution and dedup); option A changes relay-catalog probing. The two families are orthogonal. The boundary = dedup by model id at merge time (see §7). |

**Option A's key defect**: a model listed by `/v1/models` can still 404 (upstream delisting without a catalog sync). Truly judging liveness would require a minimal completion probe per model — high cost, easy to trigger quota/billing, **not recommended**. The fallback: `/v1/models` gives "in the catalog"; dead models are backfilled by runtime 404 annotations (see §5).

### Option B — daemon-side probing reported with presence (30s beat)

**Mechanism**: the daemon-side component issues `/v1/models` against the relay configured for claude-code and reports the result with presence into `claudeCodeReport` (or a new field).

| Dimension | Assessment |
|---|---|
| Probing cost | Each claude-code machine issues a GET /v1/models every 30s. Multiple machines probe the same relay redundantly. |
| Cache/TTL | Daemon-side mtime/interval caching (aligned with the mtime caching discipline of `createMachineCapabilitiesProbe`, `machine-capabilities.ts`), but the relay catalog has no local file mtime to compare, leaving only a time-window cache. |
| Failure semantics | Daemon cannot probe = reports "unknown", server fails open. Same /v1/models ≠ callable pitfall as A. |
| Key-exposure surface | **Wider**: the daemon would also need the relay apiKey. Currently the daemon does not hold the relay key (the relay is a server-side custom provider; the daemon only runs the claude-code binary reading settings.json). Pushing the key down to the daemon = a new exposure surface + a multi-machine key-distribution problem. |
| Relationship with #1287 | Same as A, orthogonal. |

**Option B's key defect**: the key-exposure surface widens (the daemon must hold the relay key), and multiple claude-code machines probe the same relay redundantly. The relay is a server-side asset; the probing right belongs to the server.

### Option C — lazy probing (probe when the selector opens)

**Mechanism**: the web selector opens → triggers one server-side `/v1/models` probe → returns the annotated catalog.

| Dimension | Assessment |
|---|---|
| Probing cost | On demand, no idle spinning. But every selector open probes = user-perceived latency (HTTP round trip). |
| Cache/TTL | A short server-side cache (e.g. 30-60s) covers rapid re-opens. |
| Failure semantics | Same as A. |
| Key-exposure surface | Same as A (server holds the key). |
| Relationship with #1287 | Orthogonal. |

**Option C's key defect**: opening the selector is a high-frequency interaction; probing every time makes the user wait. And dead models' 404s only surface at runtime, which lazy probing cannot detect.

### Recommendation: A (server-side direct connection to relay `/v1/models`, 60s cache) + runtime-404 backfill annotation

**Reasons**:
1. **Correct key ownership**: the relay is a server-side custom-provider asset (apiKeyCipher lives on the server); the probing right belongs to the server and must not sink to the daemon (avoiding B's widened key-exposure surface).
2. **Controllable cost**: the 60s cache aligns with Multica's existing 60s TTL (`r13:154` `cachedDiscovery`); the 30s presence beat does not need to trigger probing.
3. **Safe failure semantics**: `/v1/models` unreachable = mark "catalog unknown", fail open, no greying out (never mark a live model dead).
4. **Dead models rely on runtime backfill**: `/v1/models` gives "in the catalog"; true deadness (404) is backfilled from step-runtime failures (see §5) — this avoids the high cost / billing risk of a per-model completion probe.
5. **Orthogonal to #1287**: A probes the relay catalog while #1287 resolves claude-code slot aliases; the two families dedup by model id at merge time.

**Option A's known boundary (must be written into the spec)**: listed by `/v1/models` ≠ callable (upstream delisting without a catalog sync). Therefore the liveness three-state = `alive` (in the catalog + not reported dead at runtime) / `dead` (runtime-404 backfilled) / `unknown` (in the catalog but never run / probing failed). **No active completion probing** (cost / billing / false-kill risk).

---

## 4. Write-gate semantics fix: `homeMachineRejectReason` from "inside the slot list" to "inside the merged catalog and alive"

### 4.1 Current criterion (`dispatch-eligibility.ts:269-285`)

```
runtime === 'claude-code' && modelId != null
  → report.installed && report.models.some(m => m.id === modelId)
  → otherwise 400 "model X not configured"
```

`report = machine.claudeCodeReport` (only the claude-code-section 5-entry slot list is checked).

### 4.2 Fix landing point

The gate's semantics change from "modelId is inside this machine's claude-code slot list" to "modelId is inside the merged catalog (relay live catalog ∪ claude-code slots) and not dead".

- **Live-catalog source**: the relay `/v1/models` probed under option A (the alive-model set).
- **claude-code slots**: still provided by `machine.claudeCodeReport` (a true-name deduped list after #1287's resolution).
- **Merge = union by model id, liveness takes the strict reading**: being in the relay live catalog or in the slot list both count as "configurable"; entries marked dead cannot be configured (greyed out + an error naming them).

### 4.3 Impact surface (confirming there is no second model-list gate)

- Claim surface (`machines.ts` chief `:735`, worker same shape): only checks `!agentRow.modelId` (non-empty) + `runtimeGatePasses` + `capabilityGatePasses`, **not list membership** — the claim is unaffected and needs no change.
- `personas.ts:pickPersonaModel` (`:n`): takes the first entry of the `claudeCodeReport.models` default slot / falls back to the first pi-provider model — **a value-selection surface, not a gate**, but after option A it can prefer selecting from the live catalog (avoiding seeding a persona with a dead model).
- The three `homeMachineRejectReason` call sites (`routes-agents.ts:87/181/196`, `routes-resources.ts:221`) share the single source; changing one changes all.
- **There is no second model-list gate**: grep confirms `.models.some` / `report.models` appear only in `dispatch-eligibility.ts` (the gate) and `personas.ts` (value selection).

### 4.4 Post-fix copy (the T6 rule "name the machine + name the fix", precedent `dispatch-timeouts.ts`)

Following the visible-reason fallback discipline of `dispatch-timeouts.ts` (name the missing item + the fix), the dead-model rejection copy should name: the model + which machine + the fix (switch to a live model / contact the upstream). Example: `Machine mea's model deepseek-v4.1-flash has been withdrawn upstream (/v1/messages 404). Switch to a live model, or ask the upstream to restore it.`

---

## 5. UI form: grey-out/hide/annotate trade-offs for dead models; explicit errors for existing agents stuck on dead models

### 5.1 Dead models in the selector and on the providers page

- **Selector (agent-model-select / chief popover)**: dead models are **greyed out + annotated, not hidden** (visibility preserved so the user can see why a historical value is no longer selectable). The row is disabled with a `已下架` ("withdrawn") subtitle. Hiding would make the user think the model was never configured, losing diagnostic information.
- **Providers page** (read-only catalog): dead-model rows are likewise greyed out + annotated, not hidden.

### 5.2 Explicit errors for existing agents stuck on dead models

- Following the T6 rule of `dispatch-timeouts.ts` "name the machine + name the fix": when an agent's modelId is marked dead in the live catalog, the agent card / claim-failure row explicitly names "model X has been withdrawn upstream; switch models or contact the upstream".
- The claim surface (machines.ts) currently does not block dead models at the claim gate (claim does not check the list); a dead model will fail with a runtime 404 — the runtime 404 needs to be classified as a "model withdrawn" failure semantics (adding `model_unavailable` beside the existing network/quota classification in `classifyStepFailure`), landing in a visible `build.errorMessage` failure state + naming the fix.
- **Runtime-404 backfill**: a step runtime hitting `/v1/messages` 404 → `classifyStepFailure` recognizes it as `model_unavailable` → backfills a `dead` annotation for that model id into the live-catalog cache (server side) → subsequent selectors/gates grey it out + reject immediately. This closes the loop of option A's "dead models rely on runtime backfill".

### 5.3 Liveness three-state UI rendering

| State | Selector | Providers page | Gate |
|---|---|---|---|
| alive | selectable | normal | pass |
| dead | greyed out + `已下架` | greyed out + `已下架` | 400 reject + fix |
| unknown | selectable (fail-open) | normal + no annotation | pass |

---

## 6. Borrowing surface

### 6.1 Multica (`docs/research/r10`, `r13`)

- **Model-catalog sources** (`r10:148-162`, `r13:149-154`): `ListModels` dispatches by provider, one discovery per family. Claude goes through the stream-json `list_models` control protocol (there is no `--list-models`), and the answer is computed from the **installed binary + the logged-in account**.
- **Cache**: `cachedDiscovery` with a 60s TTL (`r13:154`) — this spec's option-A 60s cache aligns with this value.
- **Picker laziness**: `ModelSelectionSupported` returns false for qwenpaw/mcode/zeroclaw, and the UI shows "Managed by runtime" (`r10:162`) — pacman has no such family; not applicable.
- **Disabled rows** (`r13:107`): a disabled row in the claude catalog → `UnavailableModel` with a Reason — this spec's dead-model annotation borrows this form (dead + reason).
- **Key difference**: Multica's discovery sends list_models to a binary **it spawns itself** (the server holds binary-execution rights); pacman's claude-code is **the user's machine + the user's relay**, and the server does not spawn the claude binary. Therefore pacman cannot copy Multica's stream-json list_models probing — what pacman probes is the relay `/v1/models` (HTTP), not the claude binary control protocol.

### 6.2 spec 11 (`docs/spec/11-model-service-and-machine-localization.md`) already has rulings — conflict check

- **A3** (pi-tab data source = custom providers models[]): option-A probing does not change the pi-section data-source structure, only adds a liveness-annotation layer. **No conflict**.
- **A4** (claude-code-tab data source = reported by the execution machine, aggregated server-side by machine): option-A probing targets the relay (a pi-section asset) and does not change the claude-code-section uplink chain. **No conflict**.
- **A10** (chief-model-select options = the union of both-runtimes' models + custom providers): #1288's core change = the selector candidates must expand from "claude-code section only" to "claude-code section ∪ relay live catalog". **This is consistent with A10's "union" wording but conflicts with the current `toModelOptions` implementation that skips the pi section** — `toModelOptions` must be fixed to stop skipping relay-provider sections (or to consume a new live-catalog section). **Explicit conflict point**: A10's comment "we don't want our own relay" was the ruling of that time; #1288 seeks to overturn it (letting the relay live catalog into the selector), and spec 11 A10 needs to be marked superseded-in-part.
- **#774 collect-fallback** (when the chief main-model slot's existing value is not among the candidates → set to null): after the candidate expansion, the previously-skipped relay models are now in the candidates, so the fallback logic's trigger surface changes — needs a check, but the semantics stay the same (still in the candidates → not nulled).
- **Data contract** (`GET /api/teams/:id/model-sources`): option A may extend the `modelSource` schema with a liveness bit (`alive/dead/unknown`), or add a separate live-catalog section. **Shares `model-source.ts` with #1287 — the boundary is in §7**.

---

## 7. Boundary checklist with #1287

#1287 (in progress) changes `packages/shared/src/records/model-source.ts`'s `parseClaudeCodeModelSource`: alias resolution to true names + dedup by id. This spec changes the same file (schema gains a liveness bit) + `toModelOptions` (candidates expand to the relay live catalog) + `homeMachineRejectReason` (gate semantics).

| Boundary point | #1287 | #1288 (this spec) | Coordination |
|---|---|---|---|
| `model-source.ts` schema | changes the `parseClaudeCodeModelSource` logic (alias → true name, dedup) | adds a liveness bit (`liveness?: 'alive'\|'dead'\|'unknown'`) on `modelSourceModelSchema` | **Same file, different fields**, no textual conflict; at merge time note that if #1287 lands first, this spec adds the liveness bit on top of its deduped list |
| Dedup key | within the claude-code family, dedup by id | at merge time, dedup the relay live catalog against the claude-code family by id (cross-family) | #1287 is intra-family dedup; #1288 is inter-family merge dedup — **the two dedup layers do not conflict**, and #1288's merge takes #1287's deduped claude-code list as input |
| `toModelOptions` (`mappers.ts:1213`) | unchanged (still claude-code section only) | changed: no longer skips relay-provider sections (or consumes the live-catalog section) | #1288 exclusively owns this change; #1287 does not touch it |
| `homeMachineRejectReason` | #1287's acceptance requires "verify homeMachineRejectReason behavior does not regress" | #1288 changes the gate semantics (merged catalog + alive) | **Ordering dependency**: #1287 lands first (the claude-code list is already true-name deduped), and #1288's merged catalog judges liveness on a clean list, avoiding alias/duplicate interference in liveness decisions |
| `personas.ts pickPersonaModel` | #1287 requires a check | #1288 can let personas prefer live models | Both tickets touch this function; coordinate at merge |

**Suggested order**: #1287 lands first (intra-family dedup + alias resolution), and #1288 does the inter-family merge + probing on top of #1287's clean list. If run in parallel, #1288's spec must declare "the claude-code-section input assumes #1287's dedup has been applied".

---

## 8. Spec draft skeleton

### 8.1 Impact surface

**shared**
- `packages/shared/src/records/model-source.ts` (shared file with #1287, see §7):
  - `modelSourceModelSchema` gains `liveness?: 'alive' | 'dead' | 'unknown'` (default = unknown, fail-open)
  - possibly a new relay-live-catalog section schema (or reusing the modelSource shape + runtime='pi')
- New `packages/shared/src/records/` wire shape for the probing result (if a separate section)

**server**
- New `apps/server/src/services/model-liveness.ts` (the probing service):
  - `probeRelayCatalog(deps, providerId)` → `openProviderKey` to get the key → `fetch(baseUrl + '/v1/models')` → parse → 60s in-memory cache (aligned with `cachedDiscovery`'s 60s)
  - Fail-open on failure (returns unknown, never marks dead)
  - Runtime-404 backfill: `markModelDead(deps, providerId, modelId)` written into the cache
- `getModelSources` (`providers.ts`): relay-provider sections carry liveness annotations (or a new live-catalog section is added)
- `dispatch-eligibility.ts:homeMachineRejectReason`: criterion changes from "inside the slot list" to "inside the merged catalog and not dead"
- `classifyStepFailure` (runtime failure classification): gains `model_unavailable` (recognizing `/v1/messages` 404) → backfills dead + lands a `build.errorMessage` naming the fix
- `personas.ts:pickPersonaModel`: prefers selecting from the live catalog (avoiding seeding a dead model)

**web**
- `mappers.ts:toModelOptions`: candidates expand to claude-code section ∪ relay live catalog (no longer `continue`-skipping pi/relay sections), cross-family dedup by model id
- `agent-model-select.tsx` / `model-select-core.tsx`: dead-model rows greyed out + `已下架` annotation (disabled + subtitle)
- `providers-page.tsx`: dead-model rows greyed out + annotated
- Agent card: when modelId is marked dead, an explicit error naming it (T6 rule)

**daemon**: no changes (probing lives on the server side; the relay is a server asset).

### 8.2 Acceptance criteria

- Probing: relay `/v1/models` returns 9 entries; the UI selector shows 9 (including the 4 previously outside the slots); 2 dead models (after runtime-404 backfill) are greyed out + annotated.
- Gate: a live model (not in the slot list but in the relay catalog) no longer 400s on agent creation; a dead model creation 400s + names the fix.
- Probing failure (relay offline): everything marked unknown, nothing greyed or rejected (fail-open).
- Runtime 404: the step failure is classified as `model_unavailable`, dead is backfilled, and subsequent selectors/gates take effect immediately.
- With #1287: the claude-code-section input is #1287's deduped list; merge dedup introduces no duplicates.

### 8.3 Failure-mode list (listed before writing the implementation)

1. **Probing timeout / network down**: relay unreachable → everything marked unknown (fail-open), no live model killed by mistake.
2. **`/v1/models` lists but `/v1/messages` 404s**: in the catalog but actually withdrawn → deadness relies on runtime-404 backfill, not on probing (option A's known boundary).
3. **Corrupted key / keyfile mismatch**: `openProviderKey` throws SecretBoxError → probing fails open (marked unknown), the selector does not crash.
4. **Multiple relay providers**: each custom provider probes its own relay; the cache keys by providerId.
5. **Runtime-404 misjudgment**: a non-model-death 404 (e.g. a transient upstream fault) is mislabeled dead → the dead annotation carries a TTL (e.g. re-probe for revival after 10 minutes), or only runtime backfill without active re-probing (conservative).
6. **Same id appearing in both the claude-code section and the relay section**: cross-family dedup is first-wins, liveness takes the strict reading (dead in either family → dead).
7. **Existing agents stuck on dead models**: after the candidate expansion, existing values hit the candidates → the #774 fallback is not triggered; if dead, the card errors and names it.
8. **Merging before #1287 lands**: the claude-code section has aliases/duplicates → pass through #1287's logic before merge dedup, otherwise duplicate rows enter the selector.
9. **Upstream withdraws within the probing-cache window**: within 60s the dead state is not yet backfilled and the user picks a just-died model → the runtime 404 backfills + names the failure as the last line of defense.
10. **The relay provider row has no apiKeyCipher**: `openProviderKey` returns null → probing is skipped (marked unknown), no 400.

---

## 9. Recommended option in one sentence

**Server-side direct connection to the relay `/v1/models` for probing (60s cache, fail-open, key-reach surface following the existing `openProviderKey`/`openGithubToken` precedents), dead models backfilled by runtime-404 annotations; the selector candidates expand to the claude-code section ∪ the relay live catalog with cross-family dedup; the `homeMachineRejectReason` gate semantics change from "inside the slot list" to "inside the merged catalog and not dead".**

## 10. Boundary with #1287 in one sentence

#1287 changes `parseClaudeCodeModelSource` (intra-claude-code-family alias resolution + dedup), while this spec changes the same file's schema (liveness bit) + `toModelOptions` (candidate expansion) + the gate semantics; the two tickets touch the same file with different fields and have no textual conflict, but #1288's inter-family merge dedup takes #1287's intra-family deduped list as input — recommend #1287 lands first.
