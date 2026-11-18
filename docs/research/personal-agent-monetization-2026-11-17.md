# How similar personal agents make money (2026-11-17)

Labels: **verified** = read this round on the vendor's own page/docs (page text in this session, links inline). **inferred** = follows from verified facts. **speculative** = everything else, including every ARR/revenue number (all are company blog claims or press reports). Prices are USD, monthly billing unless noted; they move fast — re-read before relying on a number.

Scope: "similar" = products a person runs to have agents do work for them — hosted agent subscriptions, orchestration workspaces (todos.dev, Multica, Suna, OpenHands, Conductor, Vibe Kanban), BYOK shells (TypingMind, OpenClaw, DS-Bot), and adjacent self-host platforms (n8n, Dify, Open WebUI, Letta). `~/.agents/skills/research/SOURCES.md` does not exist; sources were chosen by the question. Done inline (no background agent). All prices read 2026-11-17.

## 0. Answer in five lines

1. **Almost nobody sells a personal agent for a flat price any more** — the exceptions are one-time licenses on BYOK shells (TypingMind). Every hosted product charges a subscription whose real content is a usage allowance — either an explicit credit currency (Manus, Genspark, Copilot, Lindy, Suna, Letta, AutoGPT) or an opaque rate window (Claude, ChatGPT, Kimi). The headline price ($8–$500/mo) picks the allowance size, not a feature set. (verified)
2. **The dominant 2026 shape in cairn's niche is "free when it runs on your machines and keys, paid when it runs on ours."** Todos, Amp, Suna, OpenHands Cloud, Devin and Conductor all let you bring your own subscriptions/keys for free and monetize hosted sandboxes, hosted models or the control plane instead. (verified)
3. **BYOK no longer means "no revenue".** Suna takes 5% of BYOK model spend past $1k/mo, Amp sells hosted-orb minutes while self-hosted orbs stay free, Todos bundles credits at cost inside a $19/team plan, Devin accepts "use your ChatGPT plan" while selling $20/$200 subscriptions and API-priced overage. (verified)
4. **The money concentrates on whoever resells compute or seats**: press puts Cursor at ~$4B run-rate (acquired by SpaceX, Aug 2026), Claude Code ~$2.5B, Cognition ~$900M, Manus ~$400–500M — all subscription+credits or compute resale. Pure free/OSS tools exit (Conductor→Meta), shut down (Vibe Kanban, OSS now), or stay non-commercial by design (OpenClaw, a 501(c)(3)). (speculative, press reports)
5. **For cairn, spec 18 §4 ("no selling, no project-run hosted control plane, no resold compute") already rules out every model that makes real money.** The only zero-conflict options today are sponsorship; everything else — hosted relay/push, hosted sandboxes, a hosted-service license — needs an owner ruling to relax §4. Detail in §3.

## 1. The products, grouped by how the money flows

### 1.1 Hosted subscriptions: the tier price is a usage allowance

| Product | Entry → top tier | What the money actually buys | Link |
|---|---|---|---|
| ChatGPT | Free → Go $8 → Plus $20 → Pro $100/$200/$500; Business $20–25/seat ($100–125 premium); Enterprise | Rate-limit windows on models + Codex; Pro 500 adds "Ultrafast" models; Pro tiers bundle monthly API credits to "build your own apps and agents". No annual billing on personal plans | [pricing](https://chatgpt.com/pricing/), [help](https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers), [Go launch](https://openai.com/index/introducing-chatgpt-go/) |
| Claude | Free → Pro $20 ($17 ann.) → Max $100 (5×) → Ultra $200 (10×); Team $25/seat ($100 premium); Enterprise | "5-hour and weekly" usage windows, Claude Code included from Pro up; "usage credits" pay for extra features (Fable); Max+ bundles monthly API credits | [pricing](https://claude.com/pricing) |
| Devin | Free → Pro $20 → Max $200; Teams $80/mo + $40/dev-seat; Enterprise | Hosted cloud agents (Devin Cloud); Pro includes SWE-2 free and frontier models; **extra usage "at API pricing"**, and a **"use your ChatGPT plan"** BYOS option on paid tiers | [pricing](https://devin.ai/pricing) |
| Manus | Free (300 credits/day) → Pro credit ladder $20 → $20,000/mo (4k → 5M credits); Team $20/seat (pooled); Enterprise | Explicit credit currency; tasks drain the pool, no rollover; add-on "Cloud Computer" $30–50/mo per persistent VM; SSO add-on $150 for teams <30 seats | [help](https://help.manus.im/en/articles/11711111-what-is-the-current-membership-pricing-for-manus), [team](https://manus.im/team), [secondary](https://construct.computer/blog/manus-alternatives/) |
| Genspark | Free (100 cr/day) → Plus $24.99 (10k cr, 6 tiers to $199.99) → Pro $249.99 (125k cr, to $3,999.99); Team $40/seat; Enterprise "six figures" | Credit ladder, ~20% off annual; credits cover agent runs, doc generation, model calls; weekly "Free Quota" on Standard mode on top | [business pricing](https://www.genspark.ai/business/pricing), [help](https://www.genspark.ai/helpcenter/membership-plans) |
| Cursor | Free → Plus $8 → Premium $30 → Super $100 → Ultra $200; Teams $30+/user; Enterprise | Usage pool of frontier models; cloud agents from Premium; **third-party models billed separately at API list price**; Grok API access included (post-SpaceX acquisition) | [pricing](https://cursor.com/pricing) |
| GitHub Copilot | Free → Pro $10 → Pro+ $39 → Max $100; Business/Enterprise per seat | "GitHub AI Credits": $15/$70/$200 included monthly, consumable by agent mode, code review, cloud agent; additional credits purchasable; 3rd-party agents (Claude Code, Codex) inside Pro+ | [plans](https://github.com/features/copilot/plans) |
| Replit | Free → Core $20 ($18 ann.) → $100 tier | Core includes "$20 towards more powerful models" (credits) + limited "Free Mode" hours on cheap models; credit top-ups | [pricing](https://replit.com/pricing) |
| Lindy | Free ($50 trial credits, 7 days) → $49.99/seat → custom | Pure per-seat credit model: 5,000 credits/seat pooled per workspace; top-ups $10/1,000; monthly credits do not roll over; pool exhaustion pauses work, no surprise bill | [pricing](https://www.lindy.ai/pricing) |
| Letta | Free (BYOK, 3 agents) → Pro $20 → Teams Pro | $20/mo buys $20 of credits for any model + remote sandboxes; client-side tools free, server CPU $0.00015/s; BYOK bypasses credits entirely | [pricing](https://docs.letta.com/pricing) |
| AutoGPT | Pro $50 → $320; self-host OSS; Enterprise | "Otto" agent + Expert chat; scheduled workflow runs drain a credit wallet with per-Expert caps; marketplace of community workflows; self-hosting requires BYO keys | [pricing](https://agpt.co/pricing/) |
| Kimi (China comp) | Go ¥49 → Plus ¥99 → Pro ¥199 → Max ¥699 → Ultra ¥1,399/mo | Shared monthly quota pool across features; agent-concurrency and quota multipliers per tier; **Kimi Claw = OpenClaw hosted in their cloud, billed ~0.6%/day from the shared pool**; annual prepay | [help](https://www.kimi.com/help/membership/membership-pricing) |

### 1.2 "Free on your machines + keys, paid on ours" — the closest model family to cairn

| Product | Free side | Paid side | Link |
|---|---|---|---|
| **todos.dev** (the §3.1 reference) | Free forever: BYOK + BYOC, 1 own machine, 5 agents | Pro **$19/team** ($15.20 ann.): 35k monthly credits draw platform-hosted machines + built-in models **"at the provider's own rates, with no markup"**; billed per team, not per seat | [pricing](https://todos.dev/pricing), [FAQ](https://todos.dev/) |
| **Amp** | Free tier; BYOK; "use your ChatGPT, Claude & other subs"; unlimited self-hosted orbs/runners | Megawatt **$20/mo**: 45,000 min of Amp-hosted orbs + portals; Teams "no extra charge" (members mix tiers, pooled billing); Enterprise: pooled credits, custom self-hosted-orb pricing | [pricing](https://ampcode.com/pricing) |
| **Suna / Kortix** | OSS self-host; cloud Free = 500 cr/mo, every feature | Credits ($0.01 each) buy **agent-computer time** ($0.0324/vCPU-hr etc.), from $50/mo tiers; **BYOK model spend free under $1k/mo, then 5% fee**; ChatGPT-sub connection free; Kortix-managed models = base + 5.5% | [pricing](https://www.suna.so/pricing) |
| **OpenHands Cloud** | Free BYOK tier (1 user, capped conversations) | Hosted sandboxes + integrations; **OpenHands LLM provider at cost, zero markup**, pay-as-you-go credits; Teams = self-host license **$500/mo (10 users, +$50/seat, 5k sessions)**; Enterprise custom | [pricing](https://www.openhands.dev/pricing), [BYOK post](https://hub.openhands.dev/blog/bring-your-own-llm-is-now-available-to-all-openhands-cloud-users) |
| **Conductor** | BYO subscriptions + keys (Claude Code, Codex, Cursor, OpenCode) | Paid cloud microVM workspaces (price no longer public); **joining Meta** — banner on site | [site](https://www.conductor.build/) |
| **TypingMind** | Free basic tier; key stays in the browser, calls go straight to OpenAI | **One-time lifetime license** $39–$198 (not a subscription); bulk licenses −50%; separate paid "Teams" branded workspace; "We don't sell API keys" | [pricing](https://www.typingmind.com/pricing) |

### 1.3 Open-core and license-gated self-hosting

| Product | Free side | Money side | Link |
|---|---|---|---|
| n8n | Community Edition, self-hosted, full features | Cloud priced **per workflow execution** ($20/2.5k → $800/40k+), unlimited users; fair-code license blocks commercial hosting; 50% startup discount | [pricing](https://n8n.io/pricing) |
| Dify | Community self-host free | Cloud per workspace/yr (Pro $590, Team $1,590) with trial message credits — **then "switch to your own API key"** (paid cloud is partly BYOK too); Enterprise custom | [pricing](https://dify.ai/pricing) |
| **Multica** | Source public; internal use free "including self-hosting it for your whole team" | **Own license = Apache-2.0 + conditions**: a commercial license is required to offer hosted/managed service to outsiders or embed it; hosted cloud exists (no public price) | [licensing](https://multica.ai/licensing) |
| Open WebUI | Free OSS (536k community members) | Enterprise/"Sovereign AI" contracts: SSO, RBAC, audit, air-gapped; no public price | [site](https://openwebui.com/) |

### 1.4 The no-model and exit rows

| Product | Outcome | Link |
|---|---|---|
| **OpenClaw** | Explicitly non-commercial: "No subscription. No hosted tier. No token. Stewarded by an independent 501(c)(3)." Runs on your machine, your keys — and **Kimi now resells hosted OpenClaw as "Kimi Claw"** inside its subscription quota | [site](https://openclaw.ai/), [Kimi help](https://www.kimi.com/help/membership/membership-pricing) |
| **DS-Bot** | Free Apache-2.0 OSS; README sponsor block only | [repo](https://github.com/Fei2411/DS-Bot) |
| **Vibe Kanban** | Was Free / Pro $30/user / Enterprise; **now sunsetting** — "project will continue as open source and community maintained" | [pricing](https://vibekanban.com/pricing) |
| **Conductor** | Acquired by Meta (banner) | [site](https://www.conductor.build/) |

## 2. The pattern that fits this space

Reading the tables as one market (inferred):

- **M1 — Allowance subscriptions won.** The flat "$20/mo SaaS" is dead here because COGS scales with usage. Every player re-implements the same shape: a cheap tier that is a rate limit, a headline tier ($20–50) that is a real allowance, and a power tier ($100–500) for people who burn compute. Copilot and Replit make the mapping explicit — the subscription literally is a monthly credit balance.
- **M2 — BYOK is a *tier*, not a threat.** The orchestration products cairn competes with all ship a free BYOK/own-subscription path (Todos, Amp, OpenHands, Suna, Letta, Conductor, TypingMind, Devin's "use your ChatGPT plan"). They monetize exactly the things BYOK does not cover: hosted sandbox minutes (Amp, Suna, Todos), managed models at +0–5.5% (Suna, OpenHands), seats/workspaces (Manus Team, Lindy), and the control plane (OpenHands Teams $500).
- **M3 — Compute resale is where the revenue is.** The only players at $100M+ run-rate sell model tokens or sandbox time. Zero-markup resale (OpenHands LLM provider, Todos built-in models) is used as a *conversion lever* — cheap enough to remove the last reason to BYOK — not as the profit line. Profit comes from the subscription wrapping it or the markup variants.
- **M4 — Seats are losing to pools.** Lindy, Manus Team, Copilot and Suna all pool credits across members; Todos bills per team with zero seat pricing; Amp's teams carry "no extra charge". Per-seat pricing survives only where identity/compliance matters (Copilot Business, OpenHands RBAC).
- **M5 — Source-available licensing is the standard defense against hosted resale.** Multica's Apache+conditions, n8n fair-code, Dify's added terms all draw the same line: internal self-host free, selling access to outsiders requires a license. Kimi Claw (a paid hosted OpenClaw) shows exactly what this license exists to prevent — and that it happens to permissive projects.
- **M6 — Exit or die for pure-OSS orchestrators.** Of the three products closest to cairn's shape — Conductor, Vibe Kanban, OpenClaw — one was acquired, one sunset, one chose non-profit stewardship. The free-OSS personal-orchestrator niche has not yet produced a self-sustaining company on donations or services alone. (speculative on the cause; the three outcomes are verified.)

## 3. What this means for cairn

cairn's current ruling — spec 18 §4 (owner plan D96–D105): all code Apache-2.0 + DCO, **no selling, no feature gating, no project-run hosted control plane, no resold compute** — leaves only one row of the whole table: the OpenClaw/DS-Bot row (stewardship / donations / sponsor links). If ian wants revenue later, the options ranked by how much ruling they require:

1. **GitHub Sponsors / donations.** Zero conflict, available today, and it is what DS-Bot does. Yields beer money, not a business (M6). Touches: README, `FUNDING.yml`.
2. **Paid convenience service that is not compute resale — the Obsidian Sync / Tailscale pattern.** A hosted relay/push/discovery service (cairn already plans "embedded tsnet ... a hosted relay may come later", spec 18 §4) or a hosted mobile-push bridge, sold as a small subscription while everything on the user's machines stays free and BYOK. This is the model the market validates most often for self-host tools (M2: Todos platform machines, Amp hosted orbs, Suna agent-computer). **Conflicts: needs amending spec 18 §4's "no project-run hosted control plane"** — a relay is a control plane even though it never touches compute or credentials. Touches: `docs/design/remote-access-tsnet.md`, push (`apps/server/src/services/push.ts`), plus a billing surface.
3. **Source-available relicensing (the Multica move).** Keep source public and self-host free; require a commercial license to run cairn as a hosted service for others. Defends against the Kimi-Claw scenario (someone else reselling hosted cairn). **Conflicts: reverses the Apache-2.0 + DCO ruling in spec 18 §4**; also needs re-consent or CLA handling for external contributions (currently DCO/no-CLA — a relicensing would need contributor agreements or a license that keeps inbound grants broad enough).
4. **Everything in §1.1** — subscriptions with bundled model usage, resold compute, seat billing — is fully excluded today ("no resold compute", "no gating features") and is also the wrong fight: that table is won by whoever owns the models or the cheapest compute.

Recommendation: **do nothing about monetization now** — the second-person criterion (spec 18 §2) is not met and any paywall slows the only metric that matters (a stranger installing it). If and when revenue is wanted, option 2 (a hosted relay/push subscription) is the least conflicting path that the market actually pays for; pair it with option 3's license question early, because Apache-2.0 lets a Kimi host cairn before cairn does.

## 4. What I did not check

- Multica's hosted-cloud price (no public `/pricing`), Open WebUI enterprise pricing, Conductor's pre-acquisition price — none public, marked as such.
- Conductor and sig's earlier pricing tiers — pages removed after the Meta announcement.
- All ARR/run-rate figures are press or company claims (Cursor $4B June 2026 per Forbes; Claude Code $2.5B Feb 2026 company-disclosed; Cognition $900M Sept 2026; Manus ~$400–500M mid-2026 press-reported after the Meta deal was unwound); treat as scale signals, not audited numbers.
- Chinese-market prices (Kimi, Doubao ¥68–500, Qwen office ¥19–128, DeepSeek free consumer tier) are included via one comparison roundup plus Kimi's own help page; Doubao/Qwen rows rely on that roundup.
- No product was operated for this note; pricing was read from pages/docs, so feature-line claims are vendor text.
