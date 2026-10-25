# ADR 0001 · Subscription-family provider OAuth integration

> Status: **Decided — not shipped in this round** (2026-09-28).
> Source: #301 (product of the #284 decision); recorded per that ticket's acceptance criterion "ADR or an addition to volume 06".
> Placement note: this repo's existing decision records live in the spec volumes (e.g. the P table in `09-frontend-style-unification-a6.md` and the D table in `06-open-source-and-divergence.md`); a separate `docs/adr/` is used here because spec numbers are occupied by parallel lanes (11/12 landed the same day), to avoid collisions. If these are unified later, they can be merged back into the spec volumes while keeping this file's number.

## Problem Statement

OAuth for subscription-type models (OpenAI Codex / SuperGrok / X Premium+) is **PKCE + loopback redirect on the local machine**, designed for local CLIs; pacman's OAuth handshake is **server-callback** (the authorization code returns to the server, see `startOAuthAuthorize` / `completeOAuthCallback` in `apps/server/src/services/oauth.ts`). Based on this, #284 disproved "add a row to the family table `OAUTH_FAMILIES`": adding a row would only produce a **dead button that can never complete** (rule #222: the web connect section only renders families present in the table).

#301 was therefore framed as "the only architecture path that can actually unblock the subscription family"; the ticket's proposed direction was to move the authorization initiator from the server to the daemon. **This ADR re-ran the fact reconnaissance and concludes that premise does not hold** (see F1).

## Recon facts (measured 2026-09-28, with sources for each)

| # | Fact | Source |
|---|---|---|
| F1 | **The device code flow is implemented and needs no loopback**: `login()` lets the caller choose between "Browser login (default)" and "Device code login (headless)"; the latter goes through `/api/accounts/deviceauth/usercode` + `/token` (verification page `/codex/device`) and polls | `@earendil-works/pi-ai@0.86.0` `dist/auth/oauth/openai-codex.js` (a direct dependency of this repo's daemon). ⇒ The authorization code never passes through a callback; the **premise "it must move to the daemon" disappears** |
| F2 | `toAuth(credential)` = `{ apiKey: credential.access }` — an OAuth credential is **equivalent to an apiKey at request time** | Same as above. ⇒ No change needed on the downstream wire (`StepCredentialBundle.provider.apiKey`) |
| F3 | `refresh(credential, signal)` is **pure HTTP** (carries the refresh_token); the executing machine is not involved | Same as above |
| F4 | Seam discipline **hard-forbids importing pi-ai on the server side**: "may only be consumed through the AgentBackend seam — implementations live in `apps/daemon/src/backend/`" | `biome.json` `noRestrictedImports` (mechanical block) |
| F5 | The seam's capability surface **already declares `oauthProviders: readonly string[]`** and the daemon already fills `['anthropic','openai-codex','github-copilot','xai']`; `providerConfigSchema.kind` already includes `'oauth'`. Both have **no consumption point anywhere in the repo** (declaration only, plus one test assertion) | `packages/shared/src/agent-backend.ts`, `apps/daemon/src/backend/pi.ts:49`, `apps/daemon/test/map-pi-event.test.ts:182` |
| F6 | **There is no third-party-registrable client**: xAI explicitly "rejects loopback OAuth from non-allowlisted clients"; third parties **reuse the official Grok-CLI's public `client_id`** (`b1a00492-…`) + PKCE, and the `redirect_uri` host:port must exactly match the registered value (`127.0.0.1:56121`); codex has the same structure (pi uses the official Codex CLI's `app_EMoamEEZ73f0CkXaXp7hrann`) | `pi-xai-supergrok` package `constants.ts`; pi `openai-codex.js` |
| F7 | xai **supports RFC 8628 device code**: official docs `grok login --device-auth` "for headless or remote environments"; the verification page `accounts.x.ai/oauth2/device` actually exists | xAI docs (`docs.x.ai/build/enterprise`), `accounts.x.ai` |
| F8 | pi's refresh policy is "refresh when less than `minimumValidityMs` remains before expiry, and throw if it still expires too soon after refresh" — **the whole mechanism assumes the runtime holds the refresh_token** | `dist/auth/resolve.js` |
| F9 | Today's github-copilot OAuth uses **this repo's own registered GitHub OAuth app** (`PACMAN_GITHUB_OAUTH_CLIENT_ID/SECRET`), which differs in nature from F6's "reuse someone else's public client" | `apps/server/src/services/oauth.ts` |

## Decision

| ID | Decision |
|---|---|
| **O1** | **Add no family-table rows in this round**; `OAUTH_FAMILIES` stays single-family (github-copilot); the copilot status quo (server-callback) is untouched |
| **O2** | The "reuse the official CLI's public client" pattern is **accepted** (F6 is an established fact of that ecosystem), but **not scheduled** — not shipped this round |
| **O3** | **xai verification conclusion**: endpoints are complete (`auth.x.ai/oauth2/authorize|token`, scopes include `grok-cli:access api:access`) + RFC 8628 device code supported + **no third-party-registrable client** ⇒ handled per the ticket's acceptance criterion "if not possible → record and remove from the list": **not added to the family table**. `PROVIDER_XAI_PRESET.oauthLabel` stays — it is a fidelity field collected from the original site (no consumption point on the web side, produces no dead button) |
| **O4** | If this is picked up later, the **design is already fixed** in the next section (this round's grilling already pinned down 5+ decision points; the person picking it up need not re-run them) |
| **O5** | The seam's declared-but-unconsumed `oauthProviders` and `kind:'oauth'` **stay as they are**: they describe **backend capability** (pi can do OAuth for these 4 providers), not a product commitment; this ADR is their documentation |

## If this is picked up later (warm start: the design grilling already pinned)

Supporting facts: F1 (device code needs no loopback), F2 (OAuth degrades to apiKey), F5 (seam capability already declared), F8 (refresh mechanism lives in the runtime).

| Topic | Decided |
|---|---|
| Authorization flow | **device code as the primary**; add a `flow: 'server-callback' \| 'device-code'` field to the family table, leaving a landing point for future families that only support loopback |
| Executor | **daemon executes login** (reuses pi, activating F5's `oauthProviders`; importing pi-ai on the server side violates seam discipline F4); user interaction (user_code + verification URL) goes through the **existing machine→server→web event channel** (same shape as steer/stop/sync) |
| Credential landing point | **sealed on the server** (follows the existing topology and per-step delivery semantics in 02 §8); recommended to add a sealed column + `credentialKind` discriminator column (rather than reusing `apiKeyCipher` to stuff JSON, which would force every `openProviderKey` consumption point to add discrimination) |
| Per-step delivery | **push all three of refresh + access + expires (in-memory state)**; the daemon side feeds pi's existing `InMemoryCredentialStore` so pi self-refreshes per F8 — pushing only access breaks on long steps that cross the TTL |
| First-ship families | codex + xai (anthropic is in the F5 list but is scope expansion; separate ticket) |
| CLI command | **No** `pacman auth <provider>`: the entry point is the web UI (device code naturally fits). If CLI-first is ever wanted, decide then |

## Premortem (assuming this is picked up later: the three most likely failure modes + guardrails)

| Failure mode | Guardrail |
|---|---|
| **Public client rotated or banned** (F6: we are not the client owner; xAI has said it rejects non-allowlisted clients) | Register `clientProvenance: 'reused-official-cli'` in the family table to make the risk visible; on login failure give **diagnosable copy** (distinguish "credential expired" from "client rejected"); keep the API key path as a fallback, never the only dependency |
| **Long step crosses the access TTL and the stream breaks** (F8: pi only self-refreshes when it holds the refresh_token) | Push all three credentials per the table above; if that cannot be done, refresh before the step and verify TTL > longest step (this is the **first thing** to do when picking it up) |
| **UX regression: "connecting a subscription first requires an online machine"** (today copilot needs no daemon) | The UI states this constraint explicitly at that family's entry; document it; if the constraint is judged unacceptable, the alternative route = hand-written device-code HTTP on the server (3 REST calls + polling; does not touch pi-ai so it does not violate F4), family table carries the device endpoints |

## Consequences

- **Positive**: closed with zero product code changes, no exposure to the reputational surface of reusing third-party clients; the story of the "declared-but-unconsumed OAuth seam capability" is fixed on record, so future readers will not assume codex/xai already work or are "one family-table row away".
- **Negative**: the subscription family (using ChatGPT / Grok subscriptions as model sources) is unavailable this round; reviving the capability needs a new mainline (this ADR has already pinned the design, so the cost is well below starting from zero).
- **Reopen triggers**: real usage demand for subscription-type models emerges; or a provider opens third-party client registration; or the product owner explicitly starts it.
