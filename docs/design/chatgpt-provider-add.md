# Provider add and upstream picker — 2026-11-28

## User scenario

A newcomer opens Settings → Models, adds an existing subscription, then picks models from that provider. They need an account with the selected vendor and must approve its sign-in. A device code goes to the clipboard, not storage; the existing encrypted team credential continues to authorize server requests. No extra key, payment, runner setup or screen is required for ChatGPT. On main the code is manual, the catalog request gets not found, and add has no confirmation.

| Situation | What happens | Wait / cost |
| --- | --- | --- |
| Device sign-in | Copy when the code arrives; open the vendor page synchronously and copy again; a refused automatic write leaves Copy available | Existing vendor and poll wait; no additional network or payment |
| Pick models | Fetch the subscription catalog, or show the reason and keep manual entry and retry | Existing 10-second catalog timeout; no inference cost |
| Add or remove | Show success only when the change is confirmed | Existing mutation wait; no additional request |

## Scope

1. Attempt clipboard write when the code arrives and again on Open login. Use the existing Copied feedback on success; arrival or opening refusal is silent, explicit Copy keeps its error feedback. Apply to ChatGPT, xAI and both GitHub device flows. Claude's terminal command, Devin and Antigravity local sign-in and Doubao QR are not device codes. (this change)
2. Fetch `GET https://chatgpt.com/backend-api/codex/models?client_version=0.166.0` using the existing team token materializer (including expiry refresh), Bearer and `ChatGPT-Account-Id` derived from the same token. Reject redirects at the fixed origin. Map `visibility: list` slugs to IDs; preserve valid empty results, map a malformed envelope to invalid. Initial failure has no refresh count; subscription auth failure says to sign in again. (this change)
3. Use the shared success toast after confirmed add or remove, including redirect OAuth, subscriptions and API key/custom. The existing device poll completion adds an optional `created` boolean from the successful server write; a credential replacement or an older response without this field confirms connection instead of claiming a new row. Doubao QR confirms when the row is saved, never again on closing the scan. (this change)

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
| --- | --- | --- | --- |
| Code arrives, Open login clicked after clipboard changed, automatic write refused, offline/poll timeout, restart/cancel | In-place success only on successful writes; no extra toast on arrival; original login failure and retry remain | `apps/web/e2e/provider-device-sign-in.spec.ts` | this change |
| Device add completes, replaces an existing credential, fails or is cancelled | Added only on creation, connected only on replacement, no success on failure or cancellation | `apps/web/e2e/provider-device-sign-in.spec.ts` | this change |
| ChatGPT catalog requires account routing and returns Codex slugs and visibility, not API model IDs | The picker receives real selectable models; no token in the result | `apps/server/test/codex-device-login.test.ts` | this change |
| Initial failure / slow fetch / retry; another subscription | Existing loading rows and by-ID entry; first error has no fictitious count; retry stays numbered and preserves selections | `apps/web/e2e/provider-device-sign-in.spec.ts` | this change |
| Provider not removed / confirmed remove | Error is not a success; confirmed remove reports success just once | `apps/web/e2e/provider-device-sign-in.spec.ts` | this change |
| OAuth redirects back, with or without a saved provider | The return query is cleared; a server-listed provider confirms connection, a missing row does not, and reload does not repeat it | `apps/web/e2e/provider-device-sign-in.spec.ts` | this change |
| Doubao QR row saved, scan dismissed | The add toast appears at save and does not repeat on dismiss | `apps/web/e2e/providers-doubao-subscription.spec.ts` | this change |

The named tests turn red on the parent on Copied without a click, the add/remove toast, the zero refresh wording, or the server returning a 404 instead of the list. Explicit open still runs if writing is denied. The clipboard controller owns only ephemeral success feedback, ignores success from a stale code, and never changes polling. OAuth completion requires both the existing one-time return query and the matching server-listed provider, then clears the return query; Doubao's write handler confirms the created QR row, while its separate finish handler only closes and refreshes.

## Out of scope

- Changes to model chips, runner protocols, key storage, provider inference requests and subscription sign-in mechanisms.

## Craft and scope limits

- Settings reference: Amp model routing and unavailable reason under `docs/design/references/settings/`. Compare compact status and plain next action; no draft for this existing flow.
- Reuse the fixed code/skeleton row, picker scroll body, and shared toast overlay; status changes replace text, do not add growth or change animation. Existing places for waiting, failure, retry, selection, manual fallback and cancellation remain. Fixture the 400 ms load, missing/empty catalog, denied clipboard, and long title/ID; rapid re-open and retry keep the latest attempt. Capture light/dark at 1440/390; run behavior and visual-baseline specs. No change to model chips, runner protocols, key storage or provider inference requests.
- Source: [Codex hosted base](https://github.com/openai/codex/blob/main/codex-rs/model-provider-info/src/lib.rs), [client request and `ModelsResponse`](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/endpoint/models.rs), and a redacted projection of a Codex 0.166.0 cached response in the route regression test. Amp references are visual, not a source for the API.

## Review

- Verdict: PASS
- Plan-SHA256: 81dbf8c2b35cfd9eb3c9a0b1a1f5d7b56f58e861a1723ca7f9e2cd9419f717c6
- Author-Model: openai-codex/gpt-6.2-sol
- Reviewer: independent Pi plan review and confirm-only re-stamp
- Reviewer-Model: anthropic/claude-sonnet-5-5
- Findings: clarified auth, failure behavior and proving tests; confirmed the OAuth and QR edge rows.
