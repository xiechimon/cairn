# Quota for every subscription — 2026-11-28

## User scenario

Someone who just installed Cairn connects a model subscription, then opens Settings → Models and selects it to decide whether it can handle more work. They already have the subscription; this view does not ask for another login, secret, or payment. Cairn reuses the login in the runtime that holds it, and the runs already stored on its server. A disconnected computer or upstream error leaves either a still-valid reported window or Cairn's own activity; neither absence nor an error means the account has 0% or 100% remaining.

Why: “Every subscription must show its quota”. On main only Claude and Antigravity have bars, Devin gets a missing-usage message, and ChatGPT has no quota section. [Source measurements and decisions](../research/subscription-quota-2026-11-28.md).

## Scope

1. One Quota section in both subscription detail and the ChatGPT provider editor. Reuse the existing bars and label them as vendor-reported. Claude OAuth/SDK and Antigravity's runner still write their existing snapshots; only future reset windows (or observations under 24h old when reset is unknown) display. While the detail is open, reevaluate at the next known reset or expiry; expired windows never become 100% on their own.
2. ChatGPT windows come from the Coordinator runtime's fixed `GET https://chatgpt.com/backend-api/wham/usage`, no redirects, six-second timeout, exactly the selected team's encrypted device-login record. Read-only: it does not compete with the account's normal credential rotation; if the token expired or is rejected, the next successful normal refresh can restore the quota read on reopening. Ignore responses if the selected saved credential changed during the read. No background retries. No credential or raw upstream error on the wire. Include this boundary in head security review.
3. A new authenticated, team-scoped, per-connection GET reads existing steps; it does not write data. Recorded by Cairn counts claims in inclusive `[now − 5h, now]` and `[now − 7d, now]` windows. A run is one recorded step with a claim; a rate-limited run has `rate_limit`/`quota` failure or an explicit Claude limit block. Scoped by the step's Claude, Devin, Antigravity, or Doubao subscription ID; ChatGPT uses the team's `ranModel.provider` on both task builds and Coordinator threads, because the provider service only permits one ChatGPT connection per team. Counts are current recorded step outcomes, not attempts or vendor totals. Only carry a future reset from the latest attributable recorded limit, from an explicit runtime block or a matching build error with a single failed step; no synthetic time. Keep the existing 24-hour count inside the quota section and leave its wire fields unchanged. New clients against old servers show a compact read-error state, not inferred zeros.
4. Keep provider order, sign-in, model chips, edits, verification, controls and routing outside this block unchanged. Reference: [Amp routing](references/settings/amp-model-routing.jpg) and [t3code providers](references/settings/t3code-providers.png), for quiet account detail; Cairn's current bar is the visual source of truth. Scope is one existing section (no whole-page draft). One data block updates in place, no animation, tabular figures and existing semantic tokens; no new control. Check narrow and dark in the same layout.

## Edge cases

| Situation | What they see | Proving test | Slice/Status |
|---|---|---|---|
| Claude has a window; Antigravity has distinct pools | Subscription allowance and their existing bars with actual reset times. `Claude reported window`, `Antigravity reported pools` assert the source label and bar on each detail; main lacks the label | `apps/web/e2e/providers-subscription-quota.spec.ts` | this change |
| ChatGPT weekly-only / 5h and weekly | The same bars by duration, including a real 0%. `ChatGPT recorded response` sends the exact saved account headers to the fixed URL and asserts the shape; main returns 404 | `apps/server/test/subscription-quota.test.ts` | this change |
| Devin and Doubao, recent activity | Recorded by Cairn with distinct 5h/7d counts and known upcoming reset. `recorded activity` asserts edges, isolation, and real reset; each fallback editor must use the new block; main has only a 24h count | `apps/server/test/subscription-quota.test.ts`, `apps/web/e2e/providers-subscription-quota.spec.ts` | this change |
| No Cairn activity | Two rows with zero counts, no reset claim. `confirmed empty` asserts successful exact zeros; existing 24h endpoint contract stays unchanged | `apps/server/test/subscription-quota.test.ts` | this change |
| Past reset | The expired snapshot becomes activity. `expired snapshot` asserts the stale bar disappears; main retains it | `apps/web/e2e/providers-subscription-quota.spec.ts` | this change |
| Runner disconnects | A still-valid snapshot remains with its expiry. `Antigravity reported pools` asserts the reported-quota source label while offline; main lacks it | `apps/web/e2e/providers-subscription-quota.spec.ts` | this change |
| Switch before a slow read finishes | New section never shows previous account's value. `switch during read` delays first keyed request at 390px/dark; no rapid controls or approval state in this block | `apps/web/e2e/providers-subscription-quota.spec.ts` | this change |
| Another team's account or unauthenticated request | No quota data. `scoped read` asserts 404 for foreign ID and production token middleware owns unauthenticated 401; approved team access unchanged | `apps/server/test/subscription-quota.test.ts` | this change |
| ChatGPT token is missing or expired | Cairn counts with no new login. `expired login` asserts no network call and confirmed counts; main returns 404 | `apps/server/test/subscription-quota.test.ts` | this change |
| ChatGPT returns 401, 429, 5xx or bad JSON | Cairn counts, without raw error. `upstream failures` asserts a successful local-only response; main returns 404 | `apps/server/test/subscription-quota.test.ts` | this change |
| ChatGPT request reaches deadline | Cairn counts; next opening can retry. `usage deadline` asserts the six-second deadline rejects the request and preserves confirmed local counts; main returns 404 | `apps/server/test/subscription-quota.test.ts` | this change |
| Old server returns 404, or activity read fails | Could not read quota; never fabricated zeros. `old server` holds no stale cache and retries on reopen, not in the background | `apps/web/e2e/providers-subscription-quota.spec.ts` | this change |

## Out of scope

- API-key usage, changing provider auth, plan purchase, sending prompts to learn quotas, scraping logged-in browser cookies, synthetic quotas, changing dispatch or retry policy, and recording activity outside Cairn.

## Review

- Author-Model: openai-codex/gpt-6.2-sol
- Reviewer-Model: anthropic/claude-sonnet-5-5
- Reviewer: independent Pi (medium), then low-effort confirmation of original findings only
- Plan-SHA256: 92a823c35a0ba3fb51bd1e0109e41df0396dae2061915640c5573f7aaa65caf6
- Verdict: PASS
- Fix-check: PASS
- Findings: Original findings addressed and independently confirmed; hash checked by the plan gate.
