# Review gate: why it exists, why a timer, and what to replace it with

> **Question.** Why does cairn run its own `review-gate`, why is it a timer on one Linux host, how do hosted AI reviewers do the same job, and what should cairn run instead?
>
> **Trigger.** omarchy was reinstalled on 2026-11-03. The last `review-gate` status on any PR was posted at 2026-11-02 18:22:05 UTC (#2645); open labelled PRs created after that (#2641, #2650, #2651, #2652) have no status, and Mergify will not queue them.
>
> **Method.** Repo facts read from `scripts/ops/review-gate/`, `.mergify.yml`, `apps/server/src/services/merge-gate/`, `CLAUDE.md` and git history at `5eed929ed`; status timestamps read with `gh api repos/xiechimon/cairn/commits/<sha>/statuses`. Product facts come from official docs and source repos only, collected 2026-11-03 in [assets/review-gate-hosted-reviewers-notes.md](assets/review-gate-hosted-reviewers-notes.md), which cites a URL for every claim and marks what no primary source covers as unverified. Tags below: **measured** (read or run in this study), **inferred** (derived from measured facts), **unverified**.

## 1. What the gate is today

| Piece | Fact | Source |
|---|---|---|
| Runner | `review-gate.mjs` run by the `cairn-review-gate` systemd user timer on omarchy every few minutes, from a copy under `~/.cairn/tools/review-gate/` | measured, `scripts/ops/review-gate/README.md` |
| Selection | Open non-draft PRs that touch protected paths, carry `review-gate`, or come from `lane/<n>` | measured, README |
| Reviewer | `ai-route run review` with the author's vendor excluded (`AI_ROUTE_EXCLUDE_VENDORS`, author vendor read from ai-route's local run log); `claude -p --model sonnet` with read-only tools when no non-author model is usable | measured, README, `reviewer-route.mjs` |
| Models | ai-route's review role tries subscription-logged CLIs on the host (Codex, Grok, Cursor) and metered channels through pi | measured, `~/.agents/automation/ai-route/ai-route.py` `ROLES["review"]` |
| Output | A PR comment by `cairnwright` plus a `review-gate` commit status on the head SHA, posted through the human `gh` login because the cairnwright App has no `statuses` permission | measured, README, commit `088b1a5a5` |
| Binding | The status sits on one SHA. A PASS carries over when the patch id is unchanged or the new head only merged main cleanly; a BLOCK never carries over | measured, README |
| Extras | Low-risk tier without a model; incremental re-review after BLOCK; 3 BLOCKs add `review-gate-human`; stalled heads get `review-stalled` after an hour; disarm/re-arm of GitHub auto-merge | measured, README |
| State | `~/.local/state/review-gate/` (disarmed PRs, last status) and `~/.local/state/ai-route/runs.jsonl` on the host | measured, README |
| Consumer | Mergify `default` queue requires `status-success = review-gate` | measured, `.mergify.yml` |

Two separate things carry the word "gate":

- The **omarchy review gate** above: a model review whose result is a commit status Mergify waits for.
- The **product merge gate** in `apps/server/src/services/merge-gate/readiness.ts`: for protected paths and deleted tests it blocks `independent-review-missing` unless a review verdict exists with `headSha === head`, `patchDigest === D`, a reviewer other than the author, and `modelsAreIndependent(author.model, reviewerModel)`. That is where the patch-digest binding and the other-vendor rule are enforced in code (measured). The omarchy gate binds by SHA plus patch id, not by `patchDigest`.

### Why it was built this way

From the commit history (measured) and the code (inferred where marked):

- **#2186 (2026-10-30)** tracked a timer the host already ran, "interim until the single merge executor". It started as a comment bot; a timer needs no public URL and no webhook endpoint on a home machine (inferred).
- **#2387 (2026-11-01)**: the other-vendor exclusion left Codex-authored PRs without a verdict for 13 to 17 hours when the non-Anthropic models were out of quota; the Claude fallback and the stall alert followed.
- **#2467 (2026-11-01)**: the Mergify pilot needed a status, so the verdict became a commit status.
- **Why the host:** ai-route reads Codex and Grok quota on the host where those CLIs are logged in (`ai-route.py` docstring). Reviews ride subscription allowances, not metered keys, and no model key lives in GitHub (inferred). This is the real reason for one machine: the subscriptions are logged in there.

### What the outage shows

- One host is a single point of failure for every normal-path merge. Since 18:22 UTC on 2026-11-02 nothing on the Mergify route can merge (measured).
- The status is posted by a person's token, so Mergify's bare `status-success = review-gate` accepts a `review-gate` status from anyone with push access. GitHub lets any push-access user create statuses, and `pr-evidence.yml` and `autonomy-brake.yml` hold `statuses: write` (measured). GitHub and Mergify can both pin a check to one App (`check-success = @<app-slug>/<name>`, ruleset "expected source"), but a person-posted status can't be pinned (notes, "GitHub platform facts", "Mergify conditions").
- `status-success` is missing from Mergify's current conditions reference. It still works today: PRs queued and merged on it through 2026-11-02 (measured). It may still be dropped later (unverified).
- Latency on 2026-11-02: from PR creation to the latest status, 2 to 15 minutes on PRs pushed once (#2628, #2631, #2643), and hours on PRs re-pushed or waiting on quota (measured; the timestamps don't separate the two causes).

## 2. How hosted reviewers do it

Full per-product facts with URLs: [assets/review-gate-hosted-reviewers-notes.md](assets/review-gate-hosted-reviewers-notes.md). Summary:

| Product | Trigger | Runs | Result | Can block a merge | Model / vendor | Cost for cairn (public repo) | Re-review on push |
|---|---|---|---|---|---|---|---|
| CodeRabbit | GitHub App webhook | Vendor cloud | Review + inline, `CodeRabbit` check run | Yes, through a request-changes review and a gated approval; the check run fails only on review errors | Cloud model unverified; BYO model only self-hosted (Enterprise 500+ seats) | Free for public repos | Incremental each push; checks HEAD before approving |
| Copilot code review | Ruleset "auto request Copilot" | GitHub runners | PR review | Only an opt-in approval that counts toward required approvals; no failing check | GitHub-chosen, no switch | AI credits + Actions minutes, not in Free | Only with "Review new pushes" |
| Greptile | App webhook | Vendor cloud | Summary + inline, optional status check | Optional pass/fail status (fail rule unverified) | BYO provider only self-hosted | $1 per credit; OSS may apply | `push`; dismisses its approval on new commits |
| Graphite Agent (ex-Diamond) | App | Vendor cloud | Inline | Unverified | Anthropic + OpenAI, fixed | $20 to $40 per seat | Unverified |
| Sourcery | App | Vendor cloud | Summary, inline, `Sourcery review` check | Check fails on unresolved security findings only (others unverified) | OpenAI + Anthropic; BYO on higher plans | Free for public repos | Yes |
| PR-Agent (OSS, MIT) | Action on `pull_request` / `pull_request_target`, or self-hosted App | Our runner or server | Comment, or a check run hard-coded `neutral` | No (neutral, never approves) | Any provider through litellm, our keys | Free + our model cost | Opt-in |
| Ellipsis | App | Vendor cloud | Bot review | `request_changes` / `approve` on blocking comments | Claude, GPT or Gemini per reviewer | Usage credits | Only unreviewed commits |
| Cursor Bugbot | Dashboard-connected app | Vendor cloud | Comments + `Cursor Bugbot` check | `neutral` on findings; `failure` only if the org has fail-on-unresolved | Not named | Usage-based, not in Free | Incremental; a newer commit cancels |
| `anthropics/claude-code-action` | Our workflow, any event | Our runner | Comments; the job is the check | Only through our own step reading `structured_output` | Claude only (API, Bedrock, Vertex, Foundry); `CLAUDE_CODE_OAUTH_TOKEN` uses a subscription | Minutes + tokens or subscription | As we trigger it |
| Claude Code Review (managed) | Claude App | Anthropic cloud | Inline + check run | Never; docs show parsing severity to fail your own job | Claude, fixed | Team/Enterprise usage credits | Delta review |
| Codex cloud review | Codex GitHub connection | OpenAI cloud | PR review, P0/P1 only | Unverified | OpenAI, fixed | ChatGPT plan allowance, not API keys | Per trigger setting |
| `openai/codex-action` | Our workflow | Our runner | Our step posts | Only through our own step | OpenAI or Azure endpoint, `model` input, API key | Minutes + API tokens | As we trigger it |

Patterns:

1. **Trigger.** Hosted products are GitHub Apps that receive webhooks. Self-run tools are Actions on `pull_request`. None polls (measured from docs).
2. **Verdict on a SHA.** Every product reviews per push and attaches its result to the head commit. Two of them guard approvals against a moving head: CodeRabbit re-checks HEAD before approving, and Greptile dismisses its approval on new commits. None binds to a patch digest that survives a rebase (measured from docs; absence means not documented).
3. **Blocking is rare.** Most products treat review as advice: Claude Code Review and PR-Agent never fail, Bugbot goes `neutral`. Where they do block, it is through a request-changes review or approval (CodeRabbit, Ellipsis) rather than a failing check (measured).
4. **Vendor choice.** Hosted products pick the model for you. An "other vendor than the author" rule can only be enforced by self-run tools (PR-Agent, the two vendor Actions) or self-hosted Enterprise tiers.
5. **Forks.** On a public repo, `pull_request` from a fork gets no secrets and a read-only token. `pull_request_target` gets secrets and is safe only when it never checks out and runs PR code. PR-Agent documents exactly that setup, and Claude Code Review skips forks unless a write-access user asks (notes).

## 3. Which cairn requirements are hard

| Requirement | Hard? | Why |
|---|---|---|
| A blocking signal Mergify can read on the head SHA | **Hard** | The queue needs one; advice-only reviewers can't fill this alone |
| Other-vendor reviewer | **Hard for protected and security paths only** | `CLAUDE.md`: "ordinary changes do not require another vendor"; enforced in `readiness.ts` for protected paths, which are owner-routed and never enter the Mergify queue (`.mergify.yml` file exclusions). For `review-gate` PRs it is a quality preference: an independent model has different blind spots |
| Verdict bound to `headSha` + `patchDigest` | **Hard on the product merge gate, already in code** | Any per-SHA check meets it on the Mergify route because Mergify re-reads the head. Patch-id carry-over saves cost but isn't required for safety |
| Protected-path lens | Not for the gate | Mergify excludes protected files from the queue; `pr-gate.js` and owner routing decide protected handling |
| Evidence gate | Not for the gate | Separate `pr-evidence` workflow |
| Pinned source of the verdict | **Should be hard** | Today a person-posted status can be forged by any push-access actor or workflow with `statuses: write` |
| Survives one machine going down | **Hard** (the outage) | |

## 4. Options

### (a) Keep a custom gate, run it as a GitHub Actions workflow

A `review-gate` workflow on `pull_request_target` (`opened`, `synchronize`, `labeled`, `ready_for_review`), one concurrency group per PR with cancel-in-progress. It ports the decision logic from `review-gate.mjs`: selection, low-risk tier, carry-over, vendor exclusion, the 3-BLOCK stop. State moves from `~/.local/state` to PR comments and labels. The reviewer runs per author vendor:

- Codex- or other-authored PR: Claude through `anthropics/claude-code-action` with `CLAUDE_CODE_OAUTH_TOKEN` (subscription; Claude quota is not a constraint), read-only tools.
- Claude-authored PR: GPT through `openai/codex-action` with a metered `OPENAI_API_KEY` that has a spend cap. A cheaper variant to spike: let Codex cloud's automatic review (ChatGPT plan allowance) post its PR review, and have the workflow turn "a Codex review on this head with no P0/P1" into the verdict. Whether that review is tied to a `commit_id` and how fast it arrives is unverified.

The job name is `review-gate`, so it surfaces as a check run from the `github-actions` App. Mergify switches to `check-success = review-gate`, pinned to the App if its slug form works for Actions (unverified; spike).

| Concern | Assessment |
|---|---|
| Cost | Claude reviews ride the subscription. GPT reviews are metered per token on roughly half the PRs (about 40 PRs/day on 2026-11-02, measured). Per-review token counts are unknown because omarchy's run log was lost with the reinstall, so the spike measures them first |
| Secrets on a public repo | With `pull_request_target`, the workflow file and scripts come from `main`, so a PR cannot edit the workflow that holds the keys. The reviewer reads PR files as data and runs no PR code (no install, no build, no shell tool). Prompt injection can at worst sway the verdict, not leak keys, as long as the reviewer's tools stay read-only (inferred) |
| Fork PRs | Run only when the PR author has write access, or a maintainer has added the label. Outside forks get no model review and stay on the owner route |
| Latency | Starts on the event, typically within a minute, instead of the next timer round plus a serial queue (inferred) |
| One machine down | No dependency on omarchy or the Mac. A GitHub Actions outage also stops CI, so it adds no new way to block merges |
| Failure modes | Key quota exhausted or provider down (job fails; retry with the next model in the workflow, then the stall label); a reviewer that never prints a verdict (job fails with a clear message, same as today's no-verdict path); every push costs a review (patch-id carry-over and the low-risk tier stay); duplicate job names across workflows confuse required checks (keep the name unique) |

### (b) Adopt a hosted reviewer as the required check

The strongest fit is CodeRabbit: free for public repos, incremental reviews, and a request-changes / approve workflow that checks HEAD. Mergify would require `approved-reviews-by = coderabbitai[bot]` and no outstanding change requests. Mergify's `approved-reviews-by` "only matches reviewers with admin, write or maintain permission"; whether an App bot satisfies that is unverified. The small custom parts (low-risk tier, 3-BLOCK escalation) would become small Actions.

| Concern | Assessment |
|---|---|
| Cost | $0 on the public-repo plan |
| Secrets | No model keys in the repo |
| Vendor rule | Not enforceable: the cloud model is unverified and not selectable. That is acceptable for normal paths (section 3), but cairn loses the independent-model property it has today |
| Blocking | Through reviews, not a failing check. The `CodeRabbit` check fails only on errors, and rate-limited reviews never fail, so a rate-limited PR waits without a signal (from docs) |
| One machine down | Depends on the vendor's uptime instead of one home box |
| Failure modes | Free-tier rate limits on about 40 PRs/day; the vendor changes a plan or behavior; bot-review semantics in Mergify unverified; PR text steers a reviewer that we can't configure as tightly |

### (c) Webhook-triggered job on the cairn control plane

A GitHub webhook to the cairn server enqueues a review step. Any registered machine with logged-in CLIs claims it, reviews on subscription allowance, and posts a check run through the cairnwright App (which would need `checks: write`).

| Concern | Assessment |
|---|---|
| Cost | Lowest metered spend: every vendor runs on a subscription |
| Secrets | Keys stay on machines; the App key is already on the control plane |
| Latency | Event-driven |
| One machine down | The control plane is the single point of failure; it runs on ian's Mac since 2026-11-02, so this repeats today's outage on a different host. Executors can fail over between machines |
| Failure modes | Circular dependency: a broken cairn `main` stops the reviewer that would merge its fix; webhook delivery needs a public endpoint and replay handling; the most new code of the three options |

## 5. Recommendation

**Option (a) now, with the dual-reviewer split; (c) later, as an extra executor once the control plane runs on an always-on host; (b) only as an optional advisory second opinion.**

- (a) removes the single-host failure, moves the verdict to an App-posted check that can be pinned, and keeps the independent-model review that cairn values. Secrets stay safe behind `pull_request_target`.
- The only new spend is metered OpenAI tokens on Claude-authored PRs. Measure that before cutting over. If it is too high, the Codex-cloud variant or a cheaper non-Anthropic model through a metered key keeps cost down.
- (b) gives up vendor control and blocks through reviews, which Mergify semantics may not accept for bots. Free CodeRabbit comments are still a cheap extra signal.
- (c) is the most cairn-native option, but today it only moves the single point of failure to the Mac.

### PR list

| # | Change | Route |
|---|---|---|
| 0 | Spike on a scratch repo: `codex-action` and `claude-code-action` under `pull_request_target`, token use per review on 10 real cairn diffs, Codex cloud auto-review latency and `commit_id`, Mergify `check-success = @github-actions/review-gate` pinning | No merge |
| 1 | Split `review-gate.mjs` into a runner-neutral core: decisions take PR comments and labels as state instead of `~/.local/state`; tests move along | Owner route (`scripts/**`) |
| 2 | `.github/workflows/review-gate.yml`: `pull_request_target`, no PR code executed, per-PR concurrency, vendor split, check run named `review-gate` | Owner route (`.github/**`) |
| 3 | ian adds the repo secrets `CLAUDE_CODE_OAUTH_TOKEN` and `OPENAI_API_KEY` (with a spend cap) | ian, no PR |
| 4 | `.mergify.yml`: `status-success = review-gate` → pinned `check-success`; run old and new side by side for one day first | Owner route (gate config) |
| 5 | Retire the omarchy timer: README and unit notes, remove the human-token status post | Owner route (`scripts/**`) |
| 6 | Optional: install CodeRabbit as advisory only, never required | ian (App install) |

Before any of these land, normal-path merges stay blocked. Running the same timer from the Mac as a stopgap is a separate operational decision for the coordinator.

## 6. CodeRabbit in practice on busy public repos

> **Question (follow-up).** How do busy public repos that merge many AI-authored PRs, some through a merge queue, actually use CodeRabbit? Does it block merges, how fast is it, does it hit rate limits, and does anyone pair it with a second reviewer or a custom gate?
>
> **Method.**
> - **Repos:** found with `gh search code --filename .coderabbit.yaml` (and `.yml`, plus content queries such as `request_changes_workflow: true`), 392 repos in all, ranked by stars and merged-PR count. Nine busy repos were kept. Mergify users were found with `gh search code coderabbitai --filename .mergify.yml`.
> - **What was read:** each repo's `.coderabbit.yaml` and its default-branch rulesets (`GET /repos/{o}/{r}/rules/branches/{b}`, which is public).
> - **PR sample:** the 25 most recently updated merged PRs per repo through GraphQL (225 in all), read on 2026-11-03.
> - **Limits:** classic branch protection is admin-only, so only rulesets are visible. "Time to first review" runs from PR creation to CodeRabbit's first formal review, so PRs opened as drafts inflate the tail. "AI-marked" is a keyword match on body, branch and commit messages (Claude, Codex, Cursor, Copilot, "Generated with") and can overcount from PR templates.
> - All numbers are **measured** unless tagged.

### 6.1 Repos by usage mode

| Repo | Stars | Merge path | CodeRabbit config | How it gates | Second reviewer / custom gate | AI-marked PRs (of 25) |
|---|---|---|---|---|---|---|
| [kyverno/kyverno](https://github.com/kyverno/kyverno/blob/main/.coderabbit.yaml) | 8.3k | Ruleset: 1 approval, dismiss stale, last-push approval, threads resolved, required CI | assertive, `request_changes_workflow: true`, path instructions, pre-merge checks (one `error`) | **Approval counts**: 3/40 merged PRs had only a CodeRabbit approval (#18399, #18320, #16748). Change requests get dismissed on push; 7/40 merged with CodeRabbit's last review not an approval | Copilot code review ruleset rule (`review_on_push: true`) | 19 |
| [appsmithorg/appsmith](https://github.com/appsmithorg/appsmith/blob/release/.coderabbit.yaml) | 41k | Ruleset shows only Copilot review; classic protection not visible | chill, `auto_approvals.enabled: true`, `max_merge_risk: low` | **Approval as the de facto gate**: 25/40 merged PRs had only a CodeRabbit approval (e.g. #42548, #42540); whether it is *required* is not visible (unverified) | Copilot code review rule | 17 |
| [TryGhost/Ghost](https://github.com/TryGhost/Ghost/blob/main/.coderabbit.yaml) | 56k | Ruleset: 0 approvals, two aggregate CI checks required | quiet, no request-changes, pre-merge custom checks in `error` mode (TypeScript-only new files, tooling ownership) | Advisory: `CodeRabbit` not in required checks; `error` checks act only through reviews | none seen | 4 |
| [mastra-ai/mastra](https://github.com/mastra-ai/mastra/blob/main/.coderabbit.yaml) | 29k | Ruleset: 1 approval, Lint + tests required | assertive, `commit_status: true`, `fail_commit_status: false`, incremental on | Advisory | none seen | 18 |
| [webpack/webpack](https://github.com/webpack/webpack/blob/main/.coderabbit.yaml) | 66k | Ruleset: 1 approval, no required checks | chill, `commit_status: false`, incremental on | Advisory | none seen | 24 |
| [prisma/orm](https://github.com/prisma/orm/blob/main/.coderabbit.yaml) | 48k | **GitHub merge queue** (ALLGREEN, 5 per group), 1 approval + code owners, required CI | 9-line config: path filters, base branches | Advisory: not in required checks | none seen | 22 |
| [formbricks/formbricks](https://github.com/formbricks/formbricks/blob/main/.coderabbit.yaml) | 13k | **GitHub merge queue**, 1 approval, dismiss stale, threads resolved, required CI + SonarQube | assertive, 686 lines of path instructions, `fail_commit_status: false`, a CI job validating the CodeRabbit config | Advisory, but required thread resolution makes its open threads blocking (inferred) | SonarQube required | 25 |
| [assistant-ui/assistant-ui](https://github.com/assistant-ui/assistant-ui/blob/main/.coderabbit.yaml) | 13k | **GitHub merge queue**, required `review-tier` check | 9 lines, pre-merge checks off | Advisory | **Custom gate** [`scripts/review-tier.mjs`](https://github.com/assistant-ui/assistant-ui/blob/main/scripts/review-tier.mjs) computes a risk tier and reads reviews with their `commit { oid }`; Claude (8/25 PRs) and Codex connector (1/25) also comment | 17 |
| [langwatch/langwatch](https://github.com/langwatch/langwatch/blob/main/.coderabbit.yaml) | 5k | Ruleset: 1 approval, dismiss stale, threads resolved, required `review` + `ci-complete` | chill, `auto_incremental_review: false`, all linters off | Advisory | **Required Claude review job** ([`pr-review-bot.yml`](https://github.com/langwatch/langwatch/blob/main/.github/workflows/pr-review-bot.yml), `pull_request`, same-repo only, `CLAUDE_CODE_OAUTH_TOKEN`) is the `review` check; **LLM auto-approve** ([`pr-auto-approve.yml`](https://github.com/langwatch/langwatch/blob/main/.github/workflows/pr-auto-approve.yml), `pull_request_target`) approves low-risk PRs per head SHA, relying on stale-review dismissal | 20 |

Mergify plus CodeRabbit appears only in small repos:

- [doxynix/doxynix](https://github.com/doxynix/doxynix/blob/main/.mergify.yml) (4 stars) has an auto-merge rule with `approved-reviews-by = coderabbitai[bot]`. In its last 15 merged PRs, Mergify merged only release-bot PRs; the author-gated rule never fired, and CodeRabbit left no review on those PRs (measured).
- [dangreco/os](https://github.com/dangreco/os/blob/main/.mergify.yml) (0 stars) has `approved-reviews-by = coderabbitai` for dependency PRs.
- [rmems/synthetic-factory](https://github.com/rmems/synthetic-factory/blob/main/.mergify.yml) (1 star) requires `check-success=CodeRabbit`. Its comment explains why it does not gate on approvals: every approval in that repo comes from a bot, so an approval gate "would either deadlock every merge or rubber-stamp it".
- [AditthyaSS/iloveAgents](https://github.com/AditthyaSS/iloveAgents/blob/main/.mergify.yml) (150 stars) only comments when `check-failure = CodeRabbit`.

### 6.2 Key numbers (225 merged PRs, 9 repos)

| Metric | Value |
|---|---|
| Median time to CodeRabbit's first formal review | 7.7 to 11.4 min in 7 repos (kyverno 7.7, appsmith 7.9, assistant-ui 8.6, webpack 9.0, langwatch 10.4, Ghost 11.3, prisma 11.4); formbricks 22.3; mastra 104.7 (drafts) |
| Re-reviewed a later commit (multi-commit PRs CodeRabbit reviewed) | prisma 21/22, formbricks 11/12, appsmith 14/16, webpack 17/20, mastra 8/12, Ghost 5/8, langwatch 8/14 (incremental off), assistant-ui 3/11 |
| Explicit rate-limit block | 1 of 225 (formbricks #9895, on the OSS plan per the comment footer; the reason shown was "Too many files!") |
| "Review skipped" comments | Common: langwatch 16/25 ("Auto incremental reviews are disabled on this repository"), kyverno 6, Ghost 5, formbricks 5; causes include incremental reviews off, too many files, and base branch filters |
| `CodeRabbit` check conclusion on the merged head | Mostly `SUCCESS` or `SKIPPED`; assistant-ui 18/23 `SKIPPED`; never `FAILURE` in the sample |
| `CodeRabbit` as a required check in a ruleset | 0 of 9 repos |
| CodeRabbit review threads resolved before merge | 302 of 329 (92%) |
| Human `@coderabbitai` commands | appsmith 22, langwatch 11, kyverno 10, webpack 8; others 0 to 3 |

### 6.3 Answers to the open questions

- **Rate limits on a busy free public repo.** In practice they were not a problem: 1 rate-limit-marked comment in 225 merged PRs across repos merging dozens of PRs a day, including one on the OSS plan (measured). Skipped reviews are far more common than rate limits, and a skip leaves the `CodeRabbit` check `SKIPPED`, which a `check-success` gate would treat as not passed (measured, matching section 2's Mergify fact).
- **Mergify `approved-reviews-by = coderabbitai[bot]`.** Used only in tiny repos, and the one with history (doxynix) never fired in the sample (measured). Whether Mergify's write-permission filter accepts the bot remains unverified.
- **Do CodeRabbit approvals count toward required approvals?** Yes, in practice. kyverno's ruleset requires one approval and three merged PRs had no approval other than CodeRabbit's; GraphQL reports `authorCanPushToRepository: true` for the bot (measured). That this satisfied the rule rather than an admin bypass is inferred, because bypass actors are not visible.
- **Does a CodeRabbit request-changes review gate merges?** Weakly. In kyverno, stale-review dismissal clears it on each push and CodeRabbit does not always re-request, so 7 of 40 merged PRs ended with CodeRabbit's last review not an approval (measured).
- **Pairing.** The two repos closest to cairn's problem treat CodeRabbit as advice and gate on their own Actions job:
  - langwatch: a required Claude review job, plus LLM auto-approval bound to the head SHA.
  - assistant-ui: a required custom `review-tier` check.

  Four others add Copilot's ruleset reviewer (measured). This matches option (a). Note that langwatch's review job runs on `pull_request` with a secret. A same-repo PR that edits that workflow would run the edited version with the secret, which is the risk section 4 avoids with `pull_request_target` (inferred).

**Effect on the recommendation.** None. Real repos confirm that CodeRabbit is fast and reliable as an advisor (about 8 to 11 minutes, rare rate limits). No busy repo uses its check as a required gate. The repos that gate on AI review do it with their own Actions job, which is option (a). CodeRabbit as an advisory second opinion (PR 6) stays optional.
