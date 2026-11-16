# Subscription-only model sources

Owner decisions (2026-11-16): a Runner's own `claude` login and any host or Runner Codex login stop counting as model sources. Claude Code work runs only with a Claude subscription token stored in Cairn; OpenAI Codex runs only through the team's `openai-codex` provider row, which the device-code sign-in creates.

## States

One helper decides whether Claude Code is a source for a team: `claudeCodeUsable(db, teamId)` in `apps/server/src/services/dispatch-eligibility.ts`. It is true when the team has a usable stored subscription (`hasActiveClaudeSubscription`: enabled, not expired; a revoked token is removed by its owner) and at least one Runner reports the `claude` binary (or is an orb executor).

| Subscription | `claude` on a Runner | Runner login | Claude Code usable | Defaults | Claim on that Runner |
|---|---|---|---|---|---|
| usable | installed | any | yes | Claude Code | yes, token delivered |
| usable | missing everywhere | any | no | provider fallback | no Runner passes the runtime gate |
| absent | installed | any | no | provider fallback | refused: `claude-login`, queue says add a subscription |
| expired or disabled | installed | any | no | provider fallback | refused: `claude-login` |

Defaults do not require the Runner to be online (unchanged rule: a step waits in the queue for its Runner). Dispatch requires an online Runner because only an online Runner claims; the capability router also keeps its `online` check.

Codex: an `openai-codex` row is runnable only when it holds a key (the device-code sign-in stores one). A keyless row with an empty base URL no longer falls back to the server host's `~/.codex/auth.json`, and a Runner's reported `codexLogin` is ignored.

## Paths that read the old signals

| Path | Old behavior | New behavior |
|---|---|---|
| `dispatch-eligibility.ts` `claudeCodeLoginBlocked` | blocked when no subscription and the Runner reported `not-logged-in` or an expired login | removed; callers block a Claude Code step when the team has no usable subscription |
| `machine-claim.ts` `claudeCodeLoginBlocks` | Runner login decided the claim when no subscription | no usable subscription refuses the claim; Runner login ignored |
| `machine-routing.ts` `workerIneligibility` | same login rule for the queue reason | `claude-login` reason when no usable subscription |
| `step-route.ts` `capabilityCandidates` (Claude) | available with subscription or a Runner login that was not out | available only with a usable subscription |
| `step-route.ts` `capabilityCandidates` (Codex) | candidate per Runner that reported a Codex login | candidate per Runner when the team has a keyed `openai-codex` row |
| `routing-rules.ts` `sessionHarness` / `defaultSessionChoice` | Claude Code when any Runner had `claude` installed; `codex-login` when a Runner had a Codex login | Claude Code only when `claudeCodeUsable`; the `codex-login` reason is gone |
| `routing-rules.ts` `profileForStep` stock seed fallback | fell back to a provider only when no Runner had `claude` or a Codex login | falls back whenever Claude Code is not usable |
| `routing-rules.ts` `claudeCodeCoordinatorChoice` (PR #5257) | subscription or a Runner `logged-in` gave a Claude Code Coordinator default | only `claudeCodeUsable` |
| `routing-rules.ts` `seedClaudeCodeRules` | stores rules from the defaults above | unchanged code; a local login no longer reaches it |
| `routing-rules.ts` `servingProviders` / `defaultCoordinatorChoice` | keyless `openai-codex` row with empty base URL runnable (host login) | runnable only when keyed |
| `routing-migration.ts` `seedCoordinatorRule` | seeded a Claude Code Coordinator rule at boot from a Runner `logged-in` | seeds only when `claudeCodeUsable` |
| `providers.ts` `listClaudeCodeSources` | exposed Runner `auth` to the web | stops sending `auth` |
| `model-routing.ts` `getModelRouting` | a `machine:<id>` Claude connection per Runner and a `machine:<id>:codex` connection | no Runner connections; sources are subscriptions and provider rows |
| `coordinator-route.ts` `coordinatorRouteVerdict` | keyless `openai-codex` runnable with a host Codex login | runnable only when keyed |
| `coordinator/credentials.ts` `coordinatorApiKey` | read `~/.codex/auth.json` for a keyless `openai-codex` row | returns the stored key only |
| `coordinator/codex-login.ts` | `readCodexLogin`, `codexLoginAvailable`, `usesHostCodexLogin`, `codexAuthPath` | removed; keeps `CODEX_PROVIDER_ID`, `CODEX_BASE_URL`, `CODEX_API` |
| `routing-rule-issues.ts` `providerProblem` / `runsRule` | a Runner Codex login satisfied a Codex rule; host login made a keyless row runnable | needs a keyed `openai-codex` row |
| daemon `step-preflight.ts` `agentStepRefusal` | without a token, probed `claude auth status` and ran on the Runner login | refuses a Claude Code step with no subscription token |
| legacy `legacy/agent-layer/dispatch-eligibility.ts` | takes `claudeLoginBlocked` from its caller | unchanged: no production caller |
| web `api/model-routing.ts` `routingTargets` | a "Claude Code" target from `machine:` connections | removed |
| web `top-models-card.tsx` `suggestedTopModels` | suggested Claude Code models a Runner reported | suggests them only with a usable subscription |
| web `first-run-checklist-model.ts` `modelSourceCount` | counted `machine:` connections | counts subscriptions and providers (server no longer sends Runner connections) |
| web `first-run-setup.tsx`, `routing-settings-page.tsx` copy | "this computer is signed in to Claude Code / Codex" | reasons name the Claude subscription; `codex-login` copy removed |
| web providers page Runner scope `claudeCodeStatus` | showed signed in / signed out | shows install and model state; without a subscription says to add one |
| web `claude-login-banner.tsx` / `claude-login-warning.ts` | warned about each Runner's login expiry | warns only about stored subscriptions |
| web `mappers.ts` `claude-logged-out` queue label | "run claude login on the Runner, or add a subscription" | "add a Claude subscription" |

## Failure behavior

A Claude Code step that reaches a Runner without a token fails before the session starts with a message naming `claude setup-token` and the providers settings. A team with no usable subscription sees Claude Code steps queue with the add-a-subscription label, and its defaults fall back to the earliest runnable provider.
