# Default summary routing for idle memory — 2026-11-28

## User scenario

A newcomer sends an ordinary message in a project that uses a subscription for chat. The reply works, but the idle sweep silently skips the conversation: it requires the chat model itself to accept standalone summary requests before it will consider a summary model. The user should not have to override the project's chat model to get the approved idle memory behavior. When the team already has a usable HTTP model, the sweep can use it; a subscription-only team with no summary-capable endpoint continues to skip this background feature without asking for another account or key. This means background usage on an already-connected HTTP endpoint can start for subscription conversations that were previously skipped. After the existing 10-minute threshold it receives the existing bounded excerpt (messages, existing memory, and project names), not the rest of the transcript. Results still go to the same team or project memory on the user's server. There is no request to a new or unconfigured destination.

## Scope

1. Only the idle sweep uses the new selection order: usable explicit team compaction rule (including existing legacy provider resolution); usable HTTP chat rule after the project override, not a historical per-turn model; then `defaultCoordinatorChoice` restricted to the `anthropic-key` or `provider` result. An unusable candidate falls through. Usable means an HTTP provider belonging to this team, an existing model supported by its configuration, and an API key or the existing keyless-endpoint exception. Neither another team's endpoint nor a subscription runtime receives a standalone request. No new provider, extra retry, setting, state, or inference path.
2. Keep `coordinatorProviders`' existing chat and pre-compaction behavior. A request failure never changes the choice: keep the existing timeout and backoff. Scrub the credential actually resolved for the idle call before reporting its failures or diagnostics; the foreground scrubber does not know this fallback credential. Update `docs/privacy.md` with the difference between chat and the idle-summary destination.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Subscription chat with a connected HTTP model but no overrides | `uses the team HTTP default for subscription chat`: the default HTTP model saves the memory once the project is idle; one summary request on that endpoint | `apps/server/test/coordinator/idle-memory.test.ts` | this change |
| Subscription chat with an explicit summary rule | `honors an explicit compaction model for subscription chat`: only the explicit model gets the summary request | `apps/server/test/coordinator/idle-memory.test.ts` | this change |
| The selected fallback provider errors, even if it echoes its credential | `scrubs the idle fallback credential on failure`: only the selected model is called, no cursor or fact is saved, and errors and diagnostics do not reveal the actual credential | `apps/server/test/coordinator/idle-memory.test.ts` | this change |

Retained guards in the same test file: a usable HTTP chat model wins over the default when no explicit usable summary model exists; no connected HTTP model means no request (including an unkeyed remote or an endpoint belonging to another team); and a request error backs off without switching providers.

## Out of scope

- Adding a standalone summary API to runner/subscription backends, provisioning keys, changing provider configuration, re-ranking models by price or latency, and changing message retention or extraction timeouts.

## Review

- Verdict: PASS
- Fix-check: PASS
- Plan-SHA256: 8b8ecff54e70074b1719b464bb7084316dbb8be4f413a0bb905180609dc75754
- Author-Model: openai-codex/gpt-6.2-sol
- Reviewer: Independent plan review, 2026-11-28
- Reviewer-Model: anthropic/claude-sonnet-5-5
- Findings: Confirmed red regression cases, eligibility and precedence, documented existing HTTP destination, and exact credential scrubbing.
