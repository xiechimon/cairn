# ADR 0001 · Subscription-family provider OAuth integration

> Status: Option A selected by the owner on 2026-10-26; implementation deferred.
> Original decision: #301, following #284, recorded on 2026-09-28. Revised by #1846.
> Owner decision: [central credentials, machine-local Claude logins](https://github.com/xiechimon/cairn/issues/1846#issuecomment-6420269738).

## Problem statement

Cairn needs subscription access that works across machines without copying long-lived credentials to every daemon. The September design delivered refresh tokens to daemons so pi could refresh during long steps. That spreads credentials and lets several machines rotate the same refresh token independently.

For example, a step that runs longer than an access token's lifetime still needs renewed access. Giving the daemon the refresh token solves expiry by giving that machine continuing account access. A server refresh call solves expiry while keeping the long-lived credential in one place.

The original ADR also treated subscription OAuth as reuse of official CLI client IDs. Provider policy and supported integrations now differ, so a working endpoint or a backend capability declaration is insufficient evidence that Cairn may offer that login.

## Provider facts and sources

### OpenAI

OpenAI offers official Sign in with ChatGPT for third-party tools and lists Pi as an open-source integration. This replaces the old blanket claim that subscription access requires borrowing the Codex CLI's public client. See [OpenAI's integration list](https://learn.chatgpt.com/docs/sign-in-with-chatgpt). [Issue #1846](https://github.com/xiechimon/cairn/issues/1846) records the launch date as 2026-09-29; the integration page does not independently date the launch.

pi-ai already includes an `openai-chatgpt` login, distinct from legacy `openai-codex`. Its implementation exchanges and refreshes tokens over HTTP and exposes the access token as `apiKey`. See the [pinned upstream implementation](https://github.com/earendil-works/pi/blob/f9daca3480732d0042b1df3a6e27221f597a620d/packages/ai/src/auth/oauth/openai-chatgpt.ts). Upstream support does not establish that Cairn's pinned dependency has this login or authorize Cairn to reuse Pi's identity.

The new flow must be evaluated on its own registration and redirect requirements. The old Codex device-code flow is not evidence that Sign in with ChatGPT supports device-code login.

### Anthropic

Anthropic prohibits third parties from offering Claude.ai login, routing subscription requests on users' behalf, or collecting, storing, or intermediating Claude.ai credentials or session tokens. See [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance), under authentication and credential use.

Cairn never wires pi-ai's Anthropic OAuth. A library's ability to perform that login is not permission to expose it. This prohibition covers both centralized credentials and daemon-side pi-ai login.

The owner explicitly keeps Claude logins on each machine through Anthropic's own flow. The central page may show each machine's Claude login state and a per-machine re-login entry. It must not import, synchronize, store, or intermediate those tokens. Anthropic API-key access remains a separate credential type.

### xAI

The supported OAuth integrations identified by #1846 are Hermes and OpenCode only. xAI documents [OpenCode subscription login](https://x.ai/news/grok-opencode), and Hermes documents its [xAI device-code flow](https://hermes-agent.nousresearch.com/docs/guides/xai-grok-oauth). These sources establish those integrations, not a general right for Cairn to register or reuse their client IDs. The exclusivity constraint comes from [the issue's research scope](https://github.com/xiechimon/cairn/issues/1846); the linked integration guides do not establish a complete client allowlist.

A reachable authorization endpoint or device-code endpoint does not establish Cairn eligibility. Cairn must verify provider approval and client provenance before enabling xAI login. The earlier acceptance of borrowed official client IDs is superseded.

## Decision

The owner chose option A: one central place for keys and permitted subscriptions, usable from every machine. This supersedes the issue body's earlier hold pending a decision. Claude remains the machine-local exception described above. This revision records the design and changes no product behavior.

The server is the only refresher. Refresh tokens never leave the server. The server performs the initial token exchange and stores refresh credentials encrypted at rest. A login flow that requires a daemon to receive a refresh token does not meet this design and must not be wired unchanged.

For each step, the daemon receives only a short-lived access token and its expiry, with a 1-hour access window. The implementation must respect the provider's actual expiry and must not claim that Cairn can shorten the validity of a provider-issued bearer token. A provider whose issued lifetime cannot meet this boundary needs review before enablement.

During a long step, the daemon makes an authenticated mid-step refresh call to the server before expiry. The server checks the requesting machine's assignment to the active step, refreshes centrally, and returns only the replacement access token and expiry. The daemon never receives a refresh token, runs a provider refresh grant, or uses pi's refresh-token store for this path.

Concurrent steps share one server-controlled refresh operation per credential. The server saves rotated refresh credentials before delivering replacement access tokens. On expiry, revocation, or refresh failure, the step reports an actionable credential failure or requests re-login. It must not fall back to copying refresh credentials to a machine.

The existing `StepCredentialBundle.provider.apiKey` access-token representation can be reused, but expiry metadata and the refresh RPC need follow-up implementation. The server must preserve the pi-ai import boundary in `biome.json`: implement provider HTTP operations behind the server credential service rather than importing pi-ai into the server. Backend `oauthProviders` declarations describe capabilities, not product permissions.

No OAuth family-table rows are added by this ADR revision. Existing GitHub Copilot behavior and the API-key path remain unchanged. The web UI is the central entry point for permitted subscription credentials; this decision does not add a CLI authentication command.

## Failure modes and required verification

- A step crosses the token lifetime. Verify a real mid-step refresh returns access and expiry only, and the step continues without a daemon-held refresh token.
- Two machines refresh the same credential. Verify central serialization and durable rotation prevent reuse of an invalidated refresh token.
- A machine requests another step's credential or refreshes after completion. Verify the server rejects the request.
- A provider revokes access or rejects the client. Report the distinction from ordinary expiry and retain API-key access as an alternative.
- A login adapter returns a refresh token to the daemon. Reject that adapter for this path and inspect wire payloads, persisted credentials, and logs for leaks.
- An upstream capability list includes Anthropic OAuth. Verify Cairn never exposes or invokes that login, and central Claude status contains no credentials.

These are implementation acceptance requirements, not claims that the current product already enforces the revised design.

## Consequences and schedule

Central refresh limits long-lived credential storage to the server and avoids independent token rotation on several machines. The server becomes necessary for renewal during long steps and is a concentrated credential store, so refresh availability, encryption, and authorization are required parts of the implementation.

The owner decision resolves option A, but it does not remove the time restriction. Follow-up implementation tickets for ChatGPT plan login, per-step tokens and refresh RPC, and xAI device-code login may be opened only after 2026-11-09 and only if option A remains selected. The owner comment says later follow-ups are tracked separately; this revision opens none. Provider eligibility must still be verified before shipping.

The [linked research artifact](https://claude.ai/artifact/9vTv3YerDcNHULn1BFrqyt) is background supplied by the issue. Provider claims above use accessible primary sources where available and explicitly identify the remaining issue-sourced constraints.
