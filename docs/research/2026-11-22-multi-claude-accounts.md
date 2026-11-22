# Should Cairn pool several Claude subscription accounts? (#2331)

Research for GitHub issue #2331 ("Multiple Claude subscription accounts with per-account
quota and account selection", plan decision D50, modeled on yetone/magpie). Measured on
`origin/main` at `830558c2f` (2026-11-22). Evidence marks: **observed** = read or fetched
first-hand for this document; **derived** = inferred from observed material; **guessed** =
everything else. Prior-art rows were collected by a research agent via `web_search`
primary-source extracts; the rows marked "re-verified" were additionally fetched first-hand
(repo source files, Anthropic pages).

## The newcomer

Someone who installed Cairn today connects **one** Claude subscription — they paste one
`claude setup-token` output (`sk-ant-oat01-…`), or they connect no subscription and their
Runner machine's own Claude Code login runs the steps. When that one account's usage limit
runs out, every queued step parks as `waiting_quota`; a banner says, in the product's
Chinese copy, "N tasks suspended waiting for quota — they resume on their own once the
allowance recovers", and a push notification says the same; the task resumes by
itself when the window resets. There is nothing to configure and nothing multi-account to
see. (All observed, see "Today's Cairn".)

To meet the feature this issue proposes, the newcomer would first have to **pay Anthropic
for a second Claude subscription** — a separate Pro or Max plan, roughly $20–200/month more —
then run `claude setup-token` on that second login and paste its token too. That is the
entire admission ticket: the feature is invisible unless the user already owns ≥2
subscriptions, and most users own one. What they must already know: how to produce a
setup-token per account; that each token is a different paid plan, not free extra quota.
What it asks of them: a second paid subscription, nothing else (the tokens are stored the
same encrypted way as the first). Where they get stuck today: a second token can already be
saved, but it is inert — there is no switch button in the UI (observed: the web API client
has no enable/disable call and the account card's actions are verify/rename/remove/models
only, `apps/web/src/resources/subscription-detail.tsx` `SubscriptionActions`), so the only
way to use it is the unadvertised `POST /:cid/enable` API, and even then parked tasks stay
bound to the old account.

## Why

The user's problem: a Claude subscription's `five_hour` and `seven_day` windows are finite,
and an orchestrator runs work unattended. When the enabled account is rejected, work parks
for up to hours although a second paid account sits idle. The demand is real for owners of
≥2 subscriptions (the issue author is one — the acceptance asks for a run "with two of
ian's accounts"), and irrelevant for everyone else. Evidence that the niche exists: every
agent-orchestration tool surveyed has a closed or deferred "multiple accounts?" issue, and
a separate category of dedicated poolers (magpie ~40k stars, claude-relay-service,
CLIProxyAPI, cc-switch, ccs) exists purely for this.

## Today's Cairn, measured on origin/main

The issue text and its 2026-11-21 triage comment are **stale** in one respect: it says
"no per-account quota rows", but per-account `quotaWindows` landed since (commit
`f106ea289`). The current state:

| Area | Behavior today | Evidence |
|---|---|---|
| Storage | `claude_subscription` holds **many** sealed setup-token rows per team (`label`, `tokenCipher`, `expiresAt`, `enabledAt`, `quotaWindows`, `models`, `lastCheck`) | observed: `apps/server/src/db/schema.ts:1512-1533` |
| How many active | **Exactly one enabled** per team, enforced by partial unique index `claude_subscription_one_enabled` on `(teamId) where enabledAt is not null`. First saved token auto-enables; later tokens save disabled | observed: schema.ts:1529-1532, `createClaudeSubscription` in `apps/server/src/services/claude-subscriptions.ts:484-520` |
| Step → account | Claim binds `step.claudeSubscriptionId` to the enabled row atomically inside the claim transaction | observed: `apps/server/src/services/machine-claim.ts:699-723` |
| Token delivery | `openClaudeSubscription` opens **only the bound row's** token; null/deleted/expired binding delivers nothing → the step runs on the machine's own Claude login. Token is injected per step as `CLAUDE_CODE_OAUTH_TOKEN` into the unmodified `claude` binary | observed: claude-subscriptions.ts:620-639, `apps/daemon/src/step-env.ts:67-71` |
| Quota reads | Daemon parses `rate_limit_event` incl. `unifiedWindows` → `POST /api/machine/rate-limit` → `machine.claudeRateLimits` (per machine) **and** `claude_subscription.quotaWindows` (per account, when the report's `stepId` resolves to a step bound to a subscription on that machine) | observed: `apps/daemon/src/backend/claude-code.ts:438-469`, `apps/server/src/services/claude-rate-limit.ts:239-268`, `docs/design/subscription-quota-wire.md` |
| What blocks dispatch | `claudeRateBlock(machine.claudeRateLimits)` — a `rejected` window whose `resetsAt` is in the future. This is **machine-keyed**: one account's rejection blocks the whole machine, including any other account | observed: `claude-rate-limit.ts:160,180-197`, `packages/shared/src/records/claude-rate-limit.ts:77-93` |
| Utilization | Windows carry `utilization`/`resetsAt` (from `unifiedWindows` or the OAuth usage endpoint probe `fetchClaudeUsageWindows` + model-probe fallback for the enabled row), but utilization does **not** gate dispatch — only `rejected` does. Per-account windows feed display only | observed: `claude-subscriptions.ts:291-335,408-456`, `records/claude-rate-limit.ts:77-93` |
| On exhaustion | Failed step → `handBackClaimed` → parked `waiting_quota` with `quotaBlock` (`source: claude_rate_limit`, `probeAt` = the block's `resetsAt`, or +7d when unknown). `sweepQuotaWaitSteps`/`refreshClaudeRateParks` release it to `pending` when the machine block clears → re-claimed → auto-resumes | observed: `claude-rate-limit.ts:286-341`, `apps/server/src/services/quota-wait.ts:57-133` |
| What the user sees | Board `QuotaBanner` ("N tasks suspended waiting for quota — auto-resume on recovery; next probe at {time}", in Chinese copy), `quota_wait` notification, account card state "quota exhausted" + "recovers in N hours" + per-window remaining % | observed: `apps/web/src/board/quota-banner.tsx`, `apps/server/src/services/notifications.ts:268-284`, `apps/web/src/resources/subscription-detail.tsx:151-185,338-375` |
| Switching | `POST /:cid/enable` verifies the target first (409 `precheck-failed` keeps the old), refuses while bound steps run (409 `running-tasks`), clears the team's `machine.claudeRateLimits`. Steps bound to the old account are held (`account-switched`) until stop+continue; a person step after a switch starts a fresh session | observed: `apps/server/src/routes-resources.ts:565-576`, `claude-subscriptions.ts:205-271`, `apps/server/src/services/claude-account-hold.ts` |
| In the UI | Accounts list with per-account state/windows already renders. **No enable/switch affordance exists in the web UI** — the endpoint is server-only today | observed: `apps/web/src/api/claude-subscriptions.ts` (no enable mutation), `subscription-detail.tsx` |

So the chassis the issue asks for already exists: several stored accounts, atomic per-step
binding, per-step token injection, per-account quota rows, park-and-auto-resume. What is
missing is exactly: (a) more than one enabled account, (b) a selection function at claim,
(c) per-account (not per-machine) quota gating for bound steps, (d) rerun a rejected step
on the next account instead of parking it.

## Prior art

| Tool | Several accounts? | Mechanism | Quota handling | Source |
|---|---|---|---|---|
| Claude Code (official) | One login per `CLAUDE_CONFIG_DIR`; `/login` switches the single login | Documented "give each account its own configuration directory"; setup-token → `CLAUDE_CODE_OAUTH_TOKEN` for headless | On limit: prints "usage limit reached … resets at X" and waits; auto-continues after reset. No pooling | observed (docs page + issues #20131 closed→config-dir, #30031 open, #46090 closed) |
| Conductor | No | Runs the user's own Claude Code login / API key, global to the app; community patch `conductor-hats` adds per-workspace config dirs | None built-in | observed (research agent: conductor.build docs, issue #46090, github.com/up1512001/conductor-hats) |
| Sculptor (Imbue) | No | BYO Claude plan via the installed CLI | "% context" chip per turn; no account layer | observed (research agent: imbue.com/product/sculptor, repo docs) |
| Vibe Kanban | No | Spawns official `claude` per worktree; issue #2187 closed pointing at third-party `ccs` | None | observed (research agent: issue #2187) |
| Crystal | No (product deprecated → Nimbalyst) | One login or API key prerequisite | None | observed (research agent: stravu/crystal README) |
| Claude Squad | No | tmux wrapper over one login; issue #195 closed: "would expect this to be built into Claude Code directly" | None | observed (research agent: smtg-ai/claude-squad #195) |
| **yetone/magpie** | **Yes — fullest model** | Two modes: credential relocation (swaps the CLI's own sign-in between saved accounts; refresh-token rotation forces "each account's refresh token lives in exactly one place") and a local gateway pooling accounts | Reads vendor windows (`five_hour`, `seven_day`, `seven_day_*`) via `rate_limit_event` + usage endpoint. **LowShare = 90 → deprioritized; SpentShare = 98 → treated spent.** Smart routing (default): among accounts with room, the one whose biggest window renews soonest ("the week, not the five hours in it"; next window only when they renew in the same hour). Unknown readings are never treated as spent. "Stays on Session" pins a conversation for prompt-cache reuse | re-verified: `internal/routes/strategies.go:16-46,122-150`, `internal/provider/codex_switch.go:157-171`, `internal/provider/claude_limits.go:15-37`, `internal/provider/sign_in_moves.go`; agent-read: README, usemagpie.ai/docs/routing-groups |
| farion1231/cc-switch | Yes | GUI moves the account keys between Claude Code's sign-in and per-account slots, with a journaled switch so an interrupted one finishes or drops | Shows plan + remaining quota per card | observed (research agent: repo CHANGELOG v4.0.21, issue #1928) |
| kaitranntt/ccs | Yes | Per-account credential dirs (`ccs work`, `ccs personal`), concurrent sessions; "Account Pools" auto-failover | Manual switching to work around limits; pools add failover | observed (research agent: repo + docs site) |
| Wei-Shaw/claude-relay-service | Yes — pool for **several people** sharing accounts | Self-hosted relay; clients repoint `ANTHROPIC_BASE_URL`; per-person keys | Per-account cooldowns + failover | observed (research agent: README; notes a fixed auth-bypass CVE and a ToS warning in README) |
| router-for-me/CLIProxyAPI | Yes | OAuth credential pool behind a local proxy | Round-robin, not quota-aware | observed (research agent: README, deepwiki) |
| musistudio/claude-code-router | Partial | API-key pools with rpm/tpm budgets; one local agent login per agent | Skips a key that would exceed budget | observed (research agent: README, issue #1839) |
| benzntech/quotio-desktop | Yes | Tauri app over a CLIProxyAPI pool | "Closest-to-refresh priority" — same idea as magpie Smart | observed (research agent: README) |
| Codex CLI (openai/codex) | Same shape as Claude Code | `CODEX_HOME` per account; `auth.json` per dir; `codex login/logout` | None surfaced | observed (research agent: learn.chatgpt.com env docs + openai/codex repo) |

**Pattern read (derived):** two families — credential relocation and request proxying.
Every orchestrator surveyed ships neither and points users at workarounds; the feature
lives only in dedicated poolers. The algorithms converge on "spend the allowance that
lapses soonest first" (magpie Smart, quotio closest-to-refresh), on never treating an
unread account as spent, and on binding a session to one account for prompt-cache reuse.
Cairn already implements the equivalent of magpie's stickiness via `step.claudeSubscriptionId`
binding + `accountHeld`.

## Anthropic's terms — can a tool pool one's own subscriptions?

Quoted verbatim from pages fetched first-hand on 2026-11-22.

**Owning several accounts is clearly allowed** (observed):
- Help Center FAQ literally answers "I have multiple accounts – how can I switch between them?"
  (support.claude.com/en/articles/13189465).
- Claude Code docs document `CLAUDE_CONFIG_DIR` for multiple accounts, and `claude setup-token`
  as the official headless credential for the unmodified binary
  (code.claude.com/docs/en/authentication).
- Anthropic's phone verification allows a maximum of three accounts per number
  (support.claude.com/en/articles/8287232 — reported by the research agent, corroborated
  by multiple sites; not re-fetched).
- A Claude Code team member stated publicly "It's not against terms of service to have
  multiple MAX accounts" (x.com/trq212/status/2024230184287949207 — reported by the
  research agent via corroborating outlets; not re-fetched).

**Pooling to defeat a limit is grey on the letter.** There is no clause capping accounts
per person and none saying "don't switch accounts at the limit" (observed: full text of
consumer-terms and AUP). The clause that bites is in the Usage Policy, "Do Not Abuse Our
Platform" (anthropic.com/legal/aup, observed):

> "Intentionally bypass or interfere with capabilities, restrictions, or guardrails
> established within our products, including by circumvention of the account sign-up or
> log-in process or by instructing the model to produce harmful outputs (e.g., jailbreaking
> or prompt injection), without prior authorization from Anthropic"

> "Resell, proxy, or otherwise provide access to Claude through unauthorized means,
> including services that route requests through consumer subscriptions or misrepresent
> the product or client being used"

> "Coordinate malicious activity across multiple accounts, or create multiple accounts, to
> avoid detection, circumvent product guardrails, or generate identical or similar inputs
> that otherwise violate our Usage Policy"

A per-account usage limit is a "restriction established within our products", and a
feature whose stated purpose is "when account A is exhausted, continue on account B" is
purpose-built to defeat it — read literally, automatic rotation sits in the violation
zone; a human choosing another account is much less clearly covered (derived). Anthropic's
own wrap-up-allowance terms reportedly withhold the allowance for "an attempt to get around
usage limits (for example, through multiple accounts or automation designed to exploit the
allowance)" — reported by the research agent via ≥3 corroborating sites, the only Anthropic
text found that names multi-account limit evasion explicitly (not re-fetched).

**Where the traffic comes from matters more** (observed, code.claude.com/docs/en/legal-and-compliance):

> "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max,
> Ultra, Team, and Enterprise subscription plans and is designed to support ordinary use
> of Claude Code and other native Anthropic applications."

> "Anthropic does not permit third-party developers to offer Claude.ai login into their own
> applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on
> behalf of their users. Moreover, developers may not collect, store, or intermediate
> Claude.ai credentials or session tokens — sign-in to a Claude account must complete
> through Anthropic's own flow."

> "[This] does not prevent an end user from signing in to the unmodified Claude Code
> binary with their own Claude subscription, including where a platform hosts Claude
> Code."

> "Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual
> usage of Claude Code and the Agent SDK."

And the help center (observed): third-party tools that "misrepresent their identity to
Anthropic's servers, attempt to route third-party traffic against subscription limits, or
otherwise violate applicable terms or policies is prohibited".

**Read for Cairn (derived):** the env-injection design is the most defensible posture —
every request is made by the *unmodified* `claude` binary under the user's own
setup-token, which is exactly the documented headless path and the hosted-platform carve-
out. A request proxy that pools subscriptions (magpie-gateway/CRS style) is what the
"route requests through consumer subscriptions" and "route third-party traffic against
subscription limits" clauses describe — the issue already scopes proxies out, and this
research confirms that is the right call. The residual grey is purely the *automatic*
rotation motive (defeating the wait), not the mechanism. Enforcement reality (agent-
reported, consistent across sources): Anthropic's public enforcement targets token
resellers and harness spoofing; no reported ban solely for switching one's own accounts —
an absence, not a guarantee, under an "if we suspect" no-refund termination standard
(observed in the ToS/AUP text).

## Scenario table

| Scenario | What the user sees today | What the system does today | Wait / cost today | With #2331 as scoped |
|---|---|---|---|---|
| Newcomer, one subscription, hits `five_hour` at 14:00, reset 18:00 | Quota banner "N tasks suspended waiting for quota", notification, account card "quota exhausted / recovers in 4 hours" | Steps park `waiting_quota`; probe at reset; auto-resume | Up to ~4h idle, $0 | Identical — one account is a pool of one |
| Owner, two saved tokens, enabled A rejected at 14:00, B idle | Same banner; B's card shows it has room | A's rejection parks the **machine**; B is never tried (machine-keyed gate); parked steps stay bound to A | ~4h idle though B could run; switching needs the unadvertised enable API and does not unpark A's steps | New claims pick B automatically; A's rejected step reruns on B; A's thread steps keep A unless spent |
| Two accounts both exhausted | — | — | — | Step parks `waiting_quota` for the account resetting first; identical UX to today's single-account park |
| Step mid-run when its account is rejected | Step fails → handed back → parked | Wait then resume on same account+session | Up to reset | Step reruns on next account with room (new session — cache/account change is declared acceptable) |
| User with only a machine login (no stored subscription) | Same banner | Same park; `claudeSubscriptionId` null, `machine.claudeRateLimits` gates | Same | Unchanged — machine-level gate stays for unbound steps |
| User asks "which account ran this" | Account card shows lastUsed/steps24h | `step.claudeSubscriptionId` recorded at claim | — | Same record, now actually varying; per-account windows already on the card |

## Recommendation

**Build it, in the smallest form, for one reason and with three fences.** The typical user
does not need it — "wait for reset, then auto-resume" is already shipped, matches Claude
Code's own behavior, and is the correct answer for one account. But Cairn already stores
several accounts, binds each step to one, reads per-account windows, and the owner runs ≥2
subscriptions; the missing delta is small and the dormant second account is real waste.
No surveyed orchestrator ships this, yet the demand recurs in all of them — being early is
a differentiator, not a risk, given the mechanism stays inside the official binary.

Smallest version (a strict subset of the issue scope — no strategies UI, no proxy, no
polling, no mid-step switch):

1. `enabledAt` = "in the pool": drop the one-enabled unique index; enabling stays
   user-initiated per account (default remains single-account — invisible to newcomers).
   UI needs only the affordance to enable a second stored account, which is missing today
   anyway.
2. Selection inside the existing claim transaction: exclude pool accounts with a live
   `claudeRateBlock(quotaWindows)`; prefer the thread's prior account (existing
   `priorSubscriptionId` machinery); else pick the account whose largest window renews
   soonest (magpie Smart's core rule — `seven_day` if present else `five_hour`); an account
   with no reading counts as having room. Utilization thresholds (90/98) are optional
   polish — rejected-not-rejected is the signal Cairn already trusts.
3. Rejected step: `handBackClaimed` already re-pends it; under a pool it is re-claimed on
   the next account with room. The `waiting_quota` park becomes the all-spent case only.
4. Quota gate for bound steps reads `claudeRateBlock(subscription.quotaWindows)` per
   account; `machine.claudeRateLimits` stays the gate for unbound (own-login) steps and a
   coarse signal.

Fences (owner rules + ToS posture): pool members are only accounts the user saved and
enabled themselves (the issue already excludes other people's accounts and any proxy);
never switch mid-step (already the binding model); keep the park-and-auto-resume path
unchanged for the all-spent and single-account cases.

## Sources read first-hand for this document

- Repo code on `origin/main` `830558c2f`: `apps/server/src/db/schema.ts`,
  `services/{claude-subscriptions,claude-rate-limit,quota-wait,machine-claim,machine-step-token,claude-account-hold,notifications,step-queue}.ts`,
  `apps/daemon/src/{step-env,backend/claude-code,machine-client}.ts`,
  `apps/web/src/{board/quota-banner,resources/{claude-subscriptions,subscription-detail,providers-page},api/{claude-subscriptions,claude-accounts}}.ts(x)`,
  `packages/shared/src/{claude-subscription,records/claude-rate-limit}.ts`,
  `docs/design/{claude-subscription-multi-account,subscription-quota-wire}.md`,
  `docs/research/2330-claude-entrypoint-and-setup-token-quota.md`.
- anthropic.com/legal/consumer-terms, anthropic.com/legal/aup,
  code.claude.com/docs/en/legal-and-compliance, support.claude.com/en/articles/13189465.
- github.com/yetone/magpie source: `internal/routes/{routes,strategies}.go`,
  `internal/provider/{claude_limits,codex_switch,sign_in_moves,logins,key_allowance}.go`.
- Issue #2331 body and comments via `gh issue view`.

Agent-collected (not re-fetched, marked in the table): orchestrator docs/issues for
Conductor, Sculptor, Vibe Kanban, Crystal, Claude Squad; cc-switch, ccs,
claude-relay-service, CLIProxyAPI, CCR, quotio READMEs; Anthropic phone-verification and
wrap-up-allowance texts; the x.com statement on multiple Max accounts.
