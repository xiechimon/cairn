# Devin subscription source

Owner decisions (2026-11-17): Devin joins the model sources as a new backend runtime `devin`. The daemon spawns the official `devin acp` server through the generic ACP backend; the binary is managed by the daemon (downloaded from the official ACP Registry into a private directory, version pinned by the registry). The subscription is a stored token delivered with each claim, mirroring the Claude subscription; a Runner's own `devin auth login` is never consulted. `claude-code` stays on the SDK-direct backend. This decision overrides the earlier research note "do not build a managed ACP registry installer" (`docs/research/t3-code-runtimes-2026-11-17.md`) — the owner explicitly chose managed download after comparing t3code.

## States

One helper decides whether Devin is a source for a team: `devinUsable(db, teamId)` in `dispatch-eligibility.ts` — true when the team has a usable stored subscription (`hasActiveDevinSubscription`: `enabledAt` set, not expired) and at least one online Runner reports the `devin` capability.

| Subscription | `devin` capability on a Runner | Devin usable | Defaults | Claim on that Runner |
|---|---|---|---|---|
| usable | reported | yes | Devin | yes, token delivered |
| usable | missing everywhere | no | provider fallback | no Runner passes the runtime gate |
| absent | reported | no | provider fallback | refused: `devin-subscription`, queue says add a subscription |
| revoked or disabled | reported | no | provider fallback | refused: `devin-subscription` |

The `devin` capability is a new field in the reported-capabilities schema (e.g. `devin: { installed, version }`): the daemon reports it only after the managed binary is resolved *and* `devin acp` answers `initialize` within a probe deadline. No orb-executor shortcut: orb guests' egress to `cdn.agentclientprotocol.com` / `static.devin.ai` is unverified, so the capability is reported only by what the probe proved.

## Token lifecycle

- `devinSubscription` table mirrors `claudeSubscription` exactly: `id/teamId/label/tokenCipher/expiresAt/enabledAt/createdAt`, `enabled` derived from `enabledAt`, one enabled row per team via a partial unique index. No `verified` column — verification is a live probe, never persisted.
- `step.devinSubscriptionId` column + claim-transaction recheck (`boundId !== enabledId` refuse), mirroring `step.claudeSubscriptionId` — prevents a mid-queue token swap from binding the step to the wrong account. A `refuseWhileRunning` equivalent blocks swapping/deleting the enabled subscription while a Devin step is running.
- Delivery chain (7 sites, not 1): `StepCredentialBundle` (`credentials.ts`) → `stepToken` branches in `machine-step-token.ts` (step + chief) → `machineTokenResponseSchema.devinToken` (non-strict schema: old daemons ignore it) → daemon `pushCredential`/`StepCredentials`/`clearCredentials` → `agentStepRefusal` input (`hasDevinToken`) → `prepareStepEnv`/`assembleStepEnv` → `SessionOpts.env`. The token is added to `credentialValues`/the credential redactor so it never reaches logs or transcripts.
- Daemon injects `WINDSURF_API_KEY=<token>` into spawn env. Whether env beats `credentials.toml`, and which HOME/XDG dirs `devin` writes, are **live-verification gates**, not assumptions — if devin still reads its own state dir, that dir is added to the confiner `state` set.
- Missing token: a `devin`-specific missing message (paste `windsurf_api_key` into settings) plus an auth-failure marker string the server recognizes (the `CLAUDE_CODE_AUTH_FAILURE_MARKER` pattern) so token rejection disables/labels the subscription instead of looping.
- Token acquisition UX: the user runs `cat ~/.local/share/devin/credentials.toml` on any machine signed in to Devin (the path is the XDG default on every platform; `devin auth status` prints it) and pastes the whole output — `extractDevinToken` in `apps/web/src/api/devin-subscriptions.ts` pulls the `windsurf_api_key` line out of pasted TOML, so a bare key also works.
- Desktop-local acquisition (built, `docs/design/devin-local-login.md`): on a Mac running Cairn Desktop the add dialog reads an existing local Devin login, or drives the CLI's own ACP `authenticate` over a spawned `devin acp` — the same mechanism T3 Code uses — and harvests the written `credentials.toml`. Remote browsers still need `devin auth login --force-manual-token-flow` (webapp-issued code relayed to the CLI) and keep the paste path.

## Managed binary

`apps/daemon/src/backend/devin-managed.ts`:

- Fetch `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json` (body cached), resolve `devin.distribution.binary` for the host platform.
- Install root is **not** under `$CAIRN_HOME` — that dir is a confiner `deniedRoot` and nothing under it can exec in a confined session. Use a private user-level dir (e.g. `~/.local/share/cairn/agents/devin/<version>/` on macOS/Linux), and add the install dir to the confiner `readable`/`state` sets; `SessionHarness` union gains `'devin'`.
- Download to a staging dir, extract, write `.install-complete`; spawn `./bin/devin acp`. Install lock (in-process + lockfile) for concurrent first-installs; install wait happens in preflight, not inside `initializeTimeoutMs`.
- Version: registry latest, resolved at boot; the resolved version is recorded in the install marker and reported in capabilities. A new registry version installs side-by-side; steps bind whatever the resolved install is (declared behavior: version may drift across boots).
- No checksum in the registry: record the downloaded tarball's sha256 + version locally at install (TOFU) and verify cached copies against it — repo precedent verifies every external download, HTTPS-only is not accepted silently. Still no publisher signature; that residual risk is accepted.
- No PATH fallback in v1; a user-installed `devin` is ignored, keeping the managed copy isolated from the user's `credentials.toml`.

## Adapter and step semantics

- `BACKEND_RUNTIME_IDS` gains `'devin'`. Everything that pattern-matches `'claude-code'` is a required edit, not a single-point change: `stepRuntimeFor` (dispatch-eligibility), `backendFor` (machine-loop), `briefBackendForProvider` (brief-file), `runner.ts` token selection — otherwise `'devin'` silently falls into claude-code behavior.
- `machine-loop.ts` builds `devinBackend = createAcpBackend({ harness: 'devin', command: managedBin, args: ['acp'], normalizeUpdate: devinNormalize })`; the `harness` zod enum gains `'devin'`.
- Per-agent normalization is an optional `normalizeUpdate` hook on `AcpBackendOptions` (generic adapter stays agent-agnostic, matching t3code's "no agent-id checks in the generic adapter" discipline): route subagent updates by `_meta["cognition.ai/subagent_context"].parentAgentId`, promote `_meta["cognition.ai/inferenceToolName"]` to tool title, drop `plan_bypass` permission options.
- `step.harness` union gains `'devin'` at all its sites: `stepRoute.harness` column type, `stepJournalRowSchema.route.harness`, `CandidateHarness`, `BuildStepRoute.harness`, `harnessOf`, web `HARNESS_NAMES`.
- `harness` chain for routing: `ROUTED_PROVIDERS` decision — v1 keeps devin unrouted (current implicit behavior: `routed:false` skips `routedModelRunsOn`); the `CapabilityCandidate.harness` union and `routeWork` ranking stay untouched until Devin joins capacity routing.
- Session resume: devin advertises `loadSession` — `continueSession` maps to `session/load`; if live verification shows resume gaps, throw `SessionNotResumableError` so the prior chain falls back to a cold session instead of failing.
- Steering: `capabilities.steering` is fixed at construction today — add a handshake-gated flip (devin advertises `midTurnPrompts` → `capabilities.steering = true` and `steer()` maps to the mid-turn prompt instead of throwing).
- Usage: `usage_update` / prompt-result `usage` map onto `usageRows`/`ModelUsage` (token counts; `cost` omitted).
- Permissions: unattended steps cannot answer prompts — set devin's session `mode` configOption to `bypass` (its own auto-approve) and keep ACP `requestPermission` at `deny`; confinement provides the boundary. The generic adapter's permissions default stays unchanged.
- Secrets & host tools: `openAcpTools` (incl. `get_secret`) already runs for every adapter — no fail-closed exists to reuse; add a **per-adapter gate** so devin is allowed `localTools`/`remoteTools`/`mcpServers` passthrough while the mcpServers throw stays for other adapters. Documented exposure: secret values transit Cognition inference **and** may persist in Cognition-side session storage — the new element vs Claude is the storage, not the transit.
- Skills: `skillsAllowlist`/`injectedSkills` still throw on the adapter — v1 declares that Devin steps on a skill-configured agent fail fast (documented limitation), and `skillLoad` stays pi-only.
- Step kinds: `readOnly`/`lockedDown`/`remoteToolsOnly` throw on the adapter, so Devin supports `build`/`session`/`plan`/`merge` and, since ian's 2026-11-18 decision that any model may run any task (see [info-cards-in-agent-computer](info-cards-in-agent-computer.md)), info cards and Coordinator turns (`claimPendingChiefStep` binds the Devin account, `chiefStepToken` serves its token). Review, verify, digest and mail-locked Coordinator turns stay unsupported because they need `readOnly` or `remoteToolsOnly`, which Devin cannot enforce. `thinkingLevel` must be unset/`off` for Devin agents; enforce in the web agent form.
- Client capabilities: verify on the real binary whether `devin acp` needs client-side `fs`/`terminal` handlers — the generic adapter declares neither today.

## Server surfaces

| Path | Change |
|---|---|
| `dispatch-eligibility.ts` | `devinUsable`, `stepRuntimeFor`, new `MachineIneligibility` kind `devin-subscription`, `unassignedStepReason`/`runtimeMissingReason` copy |
| `step-queue.ts` | `ineligibleBlocked` switch arm |
| `records/machine-capabilities.ts` | `stepQueueBlockedSchema` enum + reported `devin` capability schema/parser |
| `machine-claim.ts`, `machine-routing.ts` | refuse / queue reason, `priorSessionOf` enabledId plumbing, `devinSubscriptionId` bind + recheck |
| `step-route.ts`, `routing-rules.ts`, `routing-migration.ts` | harness union, selectable runtime, no default seeding |
| `machine-step-token.ts`, `machine-wire.ts` | `devinToken` |
| `db/schema.ts` | `devinSubscription` table, `step.devinSubscriptionId` (migration) |
| `MODEL_SOURCE_RUNTIMES`/`LABELS`, `MACHINE_RUNTIMES`, `modelSourceSchema`, `patchMachineBodySchema` | `'devin'` everywhere |
| routes | `/api/teams/:id/devin-subscriptions/*` mirroring the eight claude endpoints, owner-only guard, `token-auth` API-key whitelist |
| web | `devin-subscriptions` API/hooks, `Devin 订阅` picker row → paste form, subscription detail page, providers-page entries/actions, routing pages `hasUsableDevinSubscription`, login banner/warning, `mappers.ts` queue labels — parallel implementation mirroring `claude-*` (no shared-surface generalization in v1) |

## Failure behavior

- No subscription: step queues with the add-a-subscription label; claim refuses pre-session (`devin-subscription`).
- Token rejected: `initialize`/`authenticate` fails → step fails pre-session with the Devin-specific message + marker; server surfaces the subscription as needing re-paste (mechanism mirrors the claude auth-failure marker, not a stored flag).
- Registry/download unreachable with no cached copy: Runner reports no `devin` capability; Devin steps wait in queue.
- Token swapped while a step runs: allowed for new claims; a running step keeps its spawn-time env. Delete/disable is refused while Devin steps run (`refuseWhileRunning`).
- `devin acp` exits mid-step: existing ACP error path reports process-crash.
- Trajectory exporter is merge-gate protected and labels provider-less assistant entries `claude-code` — Devin transcripts will be mislabeled; accepted in v1 (daemon-side transcript already carries provider info for future export).

## Verification gates (live, before ship)

1. `devin acp` honors `WINDSURF_API_KEY` over `credentials.toml`; which HOME/XDG paths it writes.
2. `session/load` resume round-trip (continueSession → second-step chain).
3. `midTurnPrompts` → steer end-to-end.
4. `mode: bypass` configOption value accepted; permission prompts stop arriving.
5. Client `fs`/`terminal` capabilities not required by devin.
6. Model `set_config_option` accepts the static model ids we expose.

## Tests, one per path

`devinUsable` truth table; claim refusal without subscription; `devinToken` wire round-trip + redactor coverage; `WINDSURF_API_KEY` injected and `credentials.toml` untouched; managed install fresh/cached-fallback/lock/partial-cleanup; adapter normalization (subagent routing, tool title, `plan_bypass` drop); `steer` handshake flip; resume via `session/load`; secrets/host-tools allowed for devin and still refused elsewhere; skill-configured agent fails fast; confined session can exec the managed binary; e2e on the verify stack: paste token → devin agent → real step with transcript + usage.
