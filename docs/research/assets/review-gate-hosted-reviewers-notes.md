# Hosted PR reviewers: primary-source notes for the review gate

Collected 2026-11-03 from official docs and official source repos only. Every bullet ends with its source.
"Unverified" means no primary source was found for that dimension; nothing here is inferred unless marked "(inference)".

Dimensions: 1 trigger, 2 where it runs, 3 how results post, 4 blocking gate, 5 model/vendor, 6 cost,
7 self-host/enterprise, 8 re-review on push, 9 forks and secrets.

## CodeRabbit

- Trigger: reviews every new PR automatically, plus `@coderabbitai` comment commands; on self-hosted GHES a GitHub App provides repository access and webhooks. https://docs.coderabbit.ai/guides/commands , https://docs.coderabbit.ai/self-hosted/github
- Runs: CodeRabbit cloud; a self-hosted container image is Enterprise-only. https://docs.coderabbit.ai/self-hosted/github
- Posts: PR review with inline comments; `reviews.review_progress` reports each review "as a check run named `CodeRabbit`" (GitHub, Cloud); with it off, or on other hosts, a `CodeRabbit` commit status (`reviews.commit_status`, default true). https://docs.coderabbit.ai/reference/configuration
- Blocking: (a) Automatic Approvals (`reviews.auto_approvals.enabled`, legacy key `reviews.request_changes_workflow`): "If the review posts actionable inline comments, CodeRabbit submits a request-changes review", and it approves only when the latest commit has a completed review, required threads are resolved and no pre-merge check fails; its approval "counts toward your Git provider's required approvals". (b) Pre-merge checks with `mode: error` "requires resolution before merging" (blocks via the request-changes workflow). (c) The check run/status ends neutral on error unless `reviews.fail_commit_status: true`, which reports errors as failed "so a required `CodeRabbit` check blocks merging"; rate-limited reviews never fail. The docs do not say the check fails on findings. https://docs.coderabbit.ai/pr-reviews/request-changes-workflow , https://docs.coderabbit.ai/reference/configuration
- Model/vendor: cloud model choice not documented (unverified). Self-hosted: "connect CodeRabbit to your own large language model provider or account"; providers not listed. https://docs.coderabbit.ai/self-hosted/github
- Cost: per seat (only seats that open PRs): Essentials $24/mo annual ($30 monthly), Team $48 ($60), Advanced $72, Enterprise contact; usage beyond hourly allowance $0.25 per reviewed file. Public repositories are free. https://www.coderabbit.ai/pricing
- Self-host: Enterprise with 500+ seats; deployment details given at onboarding; reverse tunnel option for GHES. https://docs.coderabbit.ai/self-hosted/github , https://www.coderabbit.ai/pricing
- Re-review: `reviews.auto_review.auto_incremental_review` (default true) "Re-run the review on each push"; incremental covers changes since last review; `@coderabbitai full review` restarts. Before approving, "CodeRabbit checks that the pull request HEAD has not changed" and re-checks after reviewing a new commit. https://docs.coderabbit.ai/reference/configuration , https://docs.coderabbit.ai/guides/commands , https://docs.coderabbit.ai/pr-reviews/request-changes-workflow
- Forks: not documented (unverified). App-based, so no Actions secrets involved (inference).

## GitHub Copilot code review

- Trigger: manual reviewer request, per-user automatic setting, or a branch ruleset rule "Automatically request Copilot code review" (repo, org or enterprise) with optional "Review new pushes" and "Review draft pull requests". https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/configure-automatic-review
- Runs: "standard GitHub-hosted runners" by default; larger or self-hosted runners possible; self-hosted runners do not consume Actions minutes. https://docs.github.com/en/copilot/concepts/agents/code-review
- Posts: a PR review; "Every Copilot code review includes an approval assessment in the overview comment". Comment-vs-request-changes review type not stated (unverified). https://docs.github.com/en/copilot/concepts/agents/code-review
- Blocking: "By default, Copilot's reviews do not count toward required approvals". Opt-in settings "Allow Copilot to approve pull requests" and "Allow Copilot approvals to count toward merge requirements" (glob-limitable) let an approving review satisfy required approvals. No documented failing check or request-changes gate (unverified). https://docs.github.com/en/copilot/concepts/agents/code-review , https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/configure-automatic-review
- Model/vendor: "Model switching is not supported"; effort levels Lite / Balanced (default) / Max (preview). https://docs.github.com/en/copilot/concepts/agents/code-review
- Cost: consumes AI credits plus Actions minutes for agentic capabilities; not in Copilot Free; available on Pro, Pro+, Max, Business, Enterprise. OSS-free terms not documented (unverified). https://docs.github.com/en/copilot/concepts/agents/code-review , https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/configure-automatic-review
- Self-host: GitHub-only service; self-hosted runners supported for execution. https://docs.github.com/en/copilot/concepts/agents/code-review
- Re-review: "Unless Copilot has been configured to review each push to a pull request, it will only review a pull request once." Stale-verdict handling unverified. https://docs.github.com/en/copilot/concepts/agents/code-review
- Forks: not addressed (unverified).

## Greptile

- Trigger: GitHub App with webhook (self-host requires "GitHub App with webhook URL"); `autoReview` events `open`/`push`/`rebase`; `@greptileai` manual. https://www.greptile.com/docs/self-hosting/deployment-options.md , https://www.greptile.com/docs/code-review/greptile-json-reference.md
- Runs: Greptile cloud; self-host via Docker Compose (up to ~100 devs) or Kubernetes/Helm. https://www.greptile.com/docs/self-hosting/deployment-options.md
- Posts: summary plus inline comments (`updateSummaryOnly` suppresses inline); optional `statusCheck`: "Create a GitHub status check for each review" (pass/fail indicator). Check-run vs commit-status type unverified. https://www.greptile.com/docs/code-review/greptile-json-reference.md
- Blocking: `statusCheck` can be made required (inference from pass/fail); exact fail condition unverified. `autoApprove` approves only clean 5/5 reviews; request-changes not documented; "Greptile doesn't block merges itself". https://www.greptile.com/docs/code-review/greptile-json-reference.md , https://www.greptile.com/docs/code-review/auto-approve-prs.md
- Model/vendor: cloud model not stated; `effort` tiers base/plus/apex/auto. Self-host supports "OpenAI, Anthropic, AWS Bedrock, Azure OpenAI, GCP Vertex AI". https://www.greptile.com/docs/code-review/greptile-json-reference.md , https://www.greptile.com/docs/self-hosting/deployment-options.md
- Cost: credit-based, no seat fees on Pro; $1/credit; Base 1, Plus 3, Apex 10 credits per review; Starter free (1 dev, 50 credits). OSI-licensed non-commercial projects can apply for free use. https://www.greptile.com/pricing
- Self-host: Enterprise (Docker/K8s, air-gapped, custom LLMs). https://www.greptile.com/pricing , https://www.greptile.com/docs/self-hosting/deployment-options.md
- Re-review: `push` reviews new commits; auto-approval is withheld if "New commits landed after the review started", and "When new commits are pushed to an approved PR, Greptile dismisses its earlier approval." https://www.greptile.com/docs/code-review/controlling-nitpickiness.md , https://www.greptile.com/docs/code-review/auto-approve-prs.md
- Forks: not documented (unverified).

## Graphite AI reviews (formerly Diamond, now Graphite Agent)

- Trigger: Graphite GitHub App; reviews all new PRs in selected repos. Diamond name deprecated 2025-10-08 in favor of Graphite Agent. https://graphite.com/docs/ai-reviews-setup , https://graphite.com/blog/changelog-october-16
- Runs: Graphite cloud (inference; no self-run option documented). https://graphite.com/docs/ai-reviews-setup
- Posts: inline comments with committable fixes; status shown in Graphite PR page panel. No check run documented (unverified). https://graphite.com/docs/ai-review-comments
- Blocking: not documented (unverified). The only documented Graphite status check is the stack "mergeability" check, unrelated to AI findings. https://graphite.com/docs/mergeability-status-check
- Model/vendor: AI subprocessors "Anthropic and OpenAI"; no BYO key documented. https://graphite.com/docs/ai-privacy-and-security
- Cost: Hobby free (limited AI reviews, personal repos), Starter $20/seat/mo, Team $40/seat/mo (annual), Enterprise custom. OSS terms unverified. https://graphite.com/pricing
- Self-host: GitHub Enterprise Server support page exists; no self-hosted Graphite AI documented (unverified). https://graphite.com/docs/llms.txt
- Re-review: unverified.
- Forks: unverified.

## Sourcery

- Trigger: installed as a GitHub App; "reviews a pull request as soon as it opens" and again on new commits. https://docs.sourcery.ai/start/quickstart-github/ , https://docs.sourcery.ai/Code-Review/Overview/
- Runs: Sourcery cloud; self-hosted under Enterprise. https://docs.sourcery.ai/trust/self-hosted-sourcery/
- Posts: summary in PR description, reviewer's guide comment, inline comments, and a status check "Sourcery review" (check-run vs status type unverified; app requests both checks and commit statuses write). https://docs.sourcery.ai/Code-Review/Overview/ , https://docs.sourcery.ai/start/quickstart-github/
- Blocking: yes for security findings: a blocking security comment makes the check fail and it "stays failed while a blocking security comment is unresolved"; add "Sourcery review" to branch protection. Whether non-security findings fail it is unverified. https://docs.sourcery.ai/security/github-status-checks/
- Model/vendor: OpenAI and Anthropic, not switchable in dashboard; BYO LLM (e.g. Anthropic, Azure OpenAI contracts). Plan for BYO conflicts across pages: pricing and BYO page say Enterprise, LLM-providers page says Team. https://docs.sourcery.ai/trust/llm-providers/ , https://docs.sourcery.ai/trust/bring-your-own-llm/ , https://sourcery.ai/pricing
- Cost: Open Source plan free for public repos; Pro $12/dev/mo annual ($15 monthly); Team $24 ($30); Enterprise custom. https://sourcery.ai/pricing
- Self-host: Enterprise. https://docs.sourcery.ai/trust/self-hosted-sourcery/
- Re-review: re-reviews on push; stale-check behavior unverified. https://docs.sourcery.ai/Code-Review/Overview/
- Forks: unverified.

## Qodo Merge / PR-Agent (open source, now `The-PR-Agent/pr-agent`, MIT)

- Repo: `qodo-ai/pr-agent` now resolves to `The-PR-Agent/pr-agent`, MIT, active (pushed 2026-11-02). https://github.com/The-PR-Agent/pr-agent
- Trigger: three modes. (a) GitHub Action on `pull_request` (`opened, reopened, ready_for_review, synchronize`) plus `issue_comment`; (b) `pull_request_target` variant for forks; (c) self-hosted GitHub App webhook server (gunicorn, Lambda option), webhook secret mandatory. https://github.com/The-PR-Agent/pr-agent/blob/main/docs/docs/installation/github.md
- Runs: your GitHub runner (Action) or your own server (App); hosted Qodo product also exists. https://github.com/The-PR-Agent/pr-agent/blob/main/docs/docs/installation/github.md , https://www.qodo.ai/pricing/
- Posts: PR comments (persistent review comment by default); `github.publish_as_check_run` (default false) publishes output "as GitHub Checks instead of PR comments", needing `checks: write`. https://github.com/The-PR-Agent/pr-agent/blob/main/pr_agent/settings/configuration.toml , https://github.com/The-PR-Agent/pr-agent/blob/main/docs/docs/installation/github.md
- Blocking: not a gate. The check run is created with `"conclusion": "neutral"`; `enable_auto_approval` exists but "that caller is currently commented out"; `approve_pr_on_self_review` has "no effect ... PR-Agent does not approve PRs". https://github.com/The-PR-Agent/pr-agent/blob/main/pr_agent/git_providers/github_provider.py (line ~848) , https://github.com/The-PR-Agent/pr-agent/blob/main/pr_agent/settings/configuration.toml
- Model/vendor: fully user-selectable BYO key via litellm: OpenAI, Azure, Ollama, Hugging Face, Groq, xAI, Vertex, Google AI Studio, Anthropic, Bedrock, DeepSeek, GLM, Kimi, Qwen, Mistral, Databricks, OpenRouter, GitHub Copilot, custom models, plus fallback models. https://github.com/The-PR-Agent/pr-agent/blob/main/docs/docs/usage-guide/changing_a_model.md
- Cost: OSS free; you pay your LLM provider and runner minutes (inference). Hosted Qodo: no permanent free tier, Pro Team $30 (up to 30 users) with credits at $0.012, Enterprise custom; OSS projects can apply to "Qodo for Open Source". https://www.qodo.ai/pricing/
- Self-host: OSS app/action fully self-hosted; hosted Qodo on-prem/air-gapped and BYOK are Enterprise. https://www.qodo.ai/pricing/
- Re-review: opt-in. Action: add `synchronize` to `pr_actions` or set `handle_push_trigger = true`; `push_commands` choose tools; merge commits and bot commits skipped by default. Incremental `/review -i` exists. https://github.com/The-PR-Agent/pr-agent/blob/main/docs/docs/usage-guide/automations_and_usage.md , https://github.com/The-PR-Agent/pr-agent/blob/main/pr_agent/settings/configuration.toml
- Forks: docs state `pull_request` from a fork gets no `OPENAI_KEY` and a read-only token; recommend `pull_request_target` with no `actions/checkout` ("does not require a local checkout"), warning not to build/run PR content with secrets. https://github.com/The-PR-Agent/pr-agent/blob/main/docs/docs/installation/github.md

## Ellipsis

- Trigger: Ellipsis GitHub App plus a review file on the default branch; each push starts reviewers whose `paths` match, at most one review per push. https://ellipsis.dev/docs/code-review
- Runs: Ellipsis cloud (compute billed per CPU/GiB). Self-host unverified. https://ellipsis.dev/docs/pricing
- Posts: PR review by `ellipsis-dev[bot]` with comments; optional summary. Check run not mentioned (unverified). https://ellipsis.dev/docs/code-review
- Blocking: comments are marked blocking or not; a review fails when any blocking comment exists; `on_fail: request_changes` and `on_pass: approve` are configurable. Required status check not mentioned. https://ellipsis.dev/docs/code-review
- Model/vendor: per-reviewer `model`; harnesses Claude Code (Claude models), Codex (GPT-6.x) and Gemini CLI (Gemini 4 Argon, 3.8 Flash). BYO key unverified. https://ellipsis.dev/docs/models
- Cost: usage-based prepaid credits (tokens + compute, 10% platform fee); no seat price; free/OSS tier not mentioned. https://ellipsis.dev/docs/pricing
- Self-host: unverified.
- Re-review: "A reviewer only looks at commits it has not reviewed before"; failed reviewers re-cover the same commits next push. https://ellipsis.dev/docs/code-review
- Forks: unverified.

## Cursor Bugbot

- Trigger: connect repos in the Cursor dashboard ("connecting turns Bugbot on"); runs on every PR update or `oncePerPr`; manual `cursor review` / `bugbot run`. GitHub App mechanism not named (unverified). https://cursor.com/docs/bugbot
- Runs: Cursor cloud; supports GHES, GitLab self-hosted, Bitbucket DC as SCMs; Bugbot itself not self-hostable (unverified). https://cursor.com/docs/bugbot
- Posts: review comments with fix links, optional summary, and a `Cursor Bugbot` check on GitHub. https://cursor.com/docs/bugbot
- Blocking: conclusions `success` (no issues and no unresolved earlier comments), `neutral` (issues found, cancelled by newer commit, or internal error), `failure` only when "configured to fail on unresolved issues", which is available only "if ... available for your organization". https://cursor.com/docs/bugbot
- Model/vendor: models not named; effort levels Low/Default/High/Smart. https://cursor.com/docs/bugbot
- Cost: usage-based (included usage then credits/on-demand); legacy seat plan exists; not in Free or Plus; OSS program not mentioned. https://cursor.com/docs/bugbot , https://cursor.com/pricing
- Self-host: unverified.
- Re-review: incremental by default ("reviews only the changes since the previous Bugbot review"); a newer commit cancels the run (neutral). https://cursor.com/docs/bugbot
- Forks: unverified.

## Claude Code GitHub Action (`anthropics/claude-code-action`)

- Trigger: a workflow you write; any event (`pull_request`, `issue_comment`, `schedule`, ...); interactive mode on `@claude`, automation mode with `prompt`. `/install-github-app` installs the Claude GitHub App, stores `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`, and opens a workflow PR. https://code.claude.com/docs/en/github-actions
- Runs: "entirely on your own GitHub runner". https://github.com/anthropics/claude-code-action/blob/main/README.md
- Posts: inline comments via `mcp__github_inline_comment__create_inline_comment`, or one summary comment; otherwise results stay in the run log; the job itself is an Actions check. https://code.claude.com/docs/en/github-actions
- Blocking: no built-in verdict; the action exposes `structured_output` (JSON schema via `--json-schema`) so a later step can fail the job, which can then be a required check (inference from docs). https://github.com/anthropics/claude-code-action/blob/main/docs/usage.md
- Model/vendor: Claude only; `--model` in `claude_args`; providers Claude API, Bedrock, Vertex (Agent Platform), Foundry; OIDC workload identity federation supported. https://code.claude.com/docs/en/github-actions
- Cost: Actions minutes plus API tokens, or subscription when using an OAuth token. https://code.claude.com/docs/en/github-actions
- Self-host: self-hosted runners possible as any Action (inference); no separate product.
- Re-review: whatever the workflow triggers on (e.g. `synchronize`); the bundled code-review skill skips PRs "that already have a comment from Claude". https://code.claude.com/docs/en/github-actions
- Forks: "On public repositories, GitHub withholds secrets from runs triggered by fork pull requests, so the review runs only on pull requests from branches in the same repository." Only write-access actors may trigger; `pull_request_target`/`workflow_run` run with base secrets and the docs warn against checking out untrusted refs into the workspace root. https://code.claude.com/docs/en/github-actions , https://github.com/anthropics/claude-code-action/blob/main/docs/security.md

## Claude Code Review (managed service)

- Trigger: Claude GitHub App; per repo "once when a pull request opens, after every push, or only on request"; `@claude review` / `@claude review always`. https://code.claude.com/docs/en/code-review
- Runs: Anthropic infrastructure, not self-hosted environments. https://code.claude.com/docs/en/code-review
- Posts: inline comments with severity (Important / Nit / Pre-existing), summary in review body, check run "Claude Code Review". https://code.claude.com/docs/en/code-review-pull-requests
- Blocking: "A review never approves or blocks the pull request"; check run "never concludes as a failure" (neutral or skipped). Docs give a `gh api` recipe to parse `<!-- bughunter-severity: {...} -->` from the check output and fail your own CI job. https://code.claude.com/docs/en/code-review-pull-requests
- Model/vendor: Code Review chooses the Claude models; no model choice; levels Quick/Standard/Deep. https://code.claude.com/docs/en/code-review
- Cost: token usage billed through usage credits, separate from plan usage; Team and Enterprise plans only; org spend limit. https://code.claude.com/docs/en/code-review-costs , https://code.claude.com/docs/en/code-review
- Self-host: GHES supported as code host; review execution not self-hostable. https://code.claude.com/docs/en/code-review
- Re-review: later reviews focus on changes since last review; a push that keeps the same diff can keep the earlier result ("Code review skipped — no new changes" / "not repeated — earlier findings still open"). https://code.claude.com/docs/en/code-review-pull-requests
- Forks: automatic reviews skip forks; a write-access `@claude review` comment starts one; Re-run does not work on forks. https://code.claude.com/docs/en/code-review-pull-requests

## OpenAI Codex cloud code review and `openai/codex-action`

- Trigger (cloud): connect repo to Codex; `@codex review` comment or "Automatic review" with a "Review trigger" setting. https://learn.chatgpt.com/docs/third-party/github
- Runs (cloud): OpenAI cloud (Codex cloud task). https://learn.chatgpt.com/docs/third-party/github
- Posts (cloud): a standard GitHub PR review with inline comments, 👀 reaction; flags only P0/P1. Check run not mentioned (unverified). https://learn.chatgpt.com/docs/third-party/github
- Blocking (cloud): not documented; review rules "don't replace tests, branch protections, or required approvals". Approve/request-changes unverified. https://learn.chatgpt.com/docs/third-party/github
- Model/vendor (cloud): not stated (unverified); OpenAI only.
- Cost (cloud): included in Plus, Pro, Business, Enterprise/Edu plan usage limits; not available with API key; "Codex for Open Source" program listed without details. https://learn.chatgpt.com/docs/pricing
- Re-review (cloud): depends on review trigger setting; specifics unverified. https://learn.chatgpt.com/docs/third-party/github
- `openai/codex-action` exists (active, pushed 2026-10-31): a GitHub Action run in your workflow on `pull_request`; inputs `openai-api-key`, `responses-api-endpoint` (e.g. Azure OpenAI), `model`, `safety-strategy` (default `drop-sudo`), `allow-users`, `allow-bots`; only write-access users trigger by default; posting is done by your own later step (example uses `actions/github-script` to comment). https://github.com/openai/codex-action/blob/main/README.md
- Forks (action): no fork-specific doc; standard GitHub rule applies (no secrets on fork `pull_request`). (inference) https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows

## GitHub platform facts

- Fork `pull_request`: "secrets are not passed to the runner when a workflow is triggered from a forked repository" (except `GITHUB_TOKEN`), and "The `GITHUB_TOKEN` has read-only permissions in pull requests from forked repositories". Dependabot PRs are treated as forks. https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- `pull_request_target`: runs in the base default-branch context; the job "receives the base repository's `GITHUB_TOKEN` and access to repository and organization secrets"; checking out and running fork code is a "pwn request". https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target
- Security Lab: `pull_request` "prevents write permissions and secrets access"; `pull_request_target` has write permission and secrets; recommended split: untrusted work under `pull_request`, privileged commenting in a `workflow_run` job consuming artifacts treated as untrusted. https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/
- Required checks: "Required status checks can be checks or commit statuses"; you can pick an app "as the expected source of status updates" and if anyone else sets it "merging won't be allowed"; "any source" requires manual author verification; job names should be unique across workflows. https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- Rulesets: expected-source app "must be installed in the repository with the `statuses:write` permission". https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- Checks API: "Write permission for the REST API to interact with checks is only available to GitHub Apps"; OAuth apps and users can only read. https://docs.github.com/en/rest/checks/runs
- Statuses API: "Users with push access in a repository can create commit statuses for a given SHA"; states `error`, `failure`, `pending`, `success`; `context` is case-insensitive. https://docs.github.com/en/rest/commits/statuses
- Stale approvals: rulesets can dismiss stale approvals on diff-affecting pushes and require approval of the most recent reviewable push. https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets

## Mergify conditions

- `check-success` is "satisfied by a `success` conclusion only"; neutral/skipped match `check-neutral`/`check-skipped`. https://docs.mergify.com/configuration/conditions/
- `check-*` reads the head commit; for commit statuses "GitHub keeps one status per context, so only the latest one posted counts" (so `check-*` covers statuses too). https://docs.mergify.com/configuration/conditions/
- App pinning: `check-success = @<github-app-slug>/<name>`; a status posted by a GitHub App also matches the qualified form, one posted by a person only the bare form; a ruleset binding a required check to one app is derived in qualified form. https://docs.mergify.com/configuration/conditions/
- `status-success`: absent from the current conditions reference; whether it is still accepted as an alias is unverified (our `.mergify.yml` uses `status-success = review-gate`). https://docs.mergify.com/configuration/conditions/

## Comparison

| Product | Trigger | Runs | Posts | True blocking gate | Model choice / BYO key | Cost | Self-host | Re-review on push | Forks |
|---|---|---|---|---|---|---|---|---|---|
| CodeRabbit | App webhook | Vendor cloud | Review + inline, `CodeRabbit` check run or status | Request-changes review + approval gate; pre-merge `error`; check fails only on error with `fail_commit_status` | Cloud unverified; BYO LLM self-host only | $24-72/seat; public repos free | Enterprise 500+ seats | Incremental each push; HEAD re-checked before approve | Unverified |
| Copilot review | Ruleset / user setting | GitHub runners (self-hosted allowed) | Review + overview | Approval can count (opt-in); no failing check | GitHub-fixed, no switch | AI credits + Actions min; not Free | No | Only if "Review new pushes" | Unverified |
| Greptile | App webhook | Vendor cloud | Summary + inline, optional status check | Status check pass/fail (fail rule unverified); auto-approve | Self-host: OpenAI/Anthropic/Bedrock/Azure/Vertex | $1/credit, no seats; OSS apply | Enterprise Docker/K8s | `push`; approval dismissed on new commits | Unverified |
| Graphite Agent | App | Vendor cloud | Inline | Unverified | Anthropic+OpenAI fixed | $20/$40 seat | Unverified | Unverified | Unverified |
| Sourcery | App | Vendor cloud | Summary, guide, inline, "Sourcery review" check | Check fails on unresolved security findings | OpenAI+Anthropic; BYO LLM (Team/Enterprise, conflicting) | $12/$24 dev; public repos free | Enterprise | Yes | Unverified |
| PR-Agent (OSS) | Action (`pull_request`/`_target`) or self-hosted App | Our runner / our server | Comment or neutral check run | No (neutral, no approve) | Any provider, BYO key | Free + own LLM cost | Yes (OSS) | Opt-in `handle_push_trigger` | `pull_request_target` without checkout |
| Qodo hosted | App | Vendor cloud | Comments | Unverified | BYOK Enterprise | $30 team + credits; OSS apply | Enterprise on-prem | Unverified | Unverified |
| Ellipsis | App | Vendor cloud | Review by bot | `request_changes` / `approve` on blocking comments | Claude/GPT/Gemini per reviewer; BYO unverified | Usage credits | Unverified | Only unreviewed commits | Unverified |
| Cursor Bugbot | Dashboard-connected app | Vendor cloud | Comments + `Cursor Bugbot` check | `failure` only if fail-on-unresolved enabled for org | Not named | Usage-based; not Free | No (SCM self-host only) | Incremental; newer commit cancels | Unverified |
| claude-code-action | Our workflow | Our runner | Inline/summary comment; job check | Only via our step on `structured_output` | Claude only (API/Bedrock/Vertex/Foundry) | Minutes + tokens/subscription | Self-hosted runner | As triggered | No secrets on fork `pull_request` |
| Claude Code Review | Claude App | Anthropic cloud | Inline + summary + check run | Never fails; parse severity yourself | Claude, fixed | Usage credits; Team/Enterprise | No | Delta review; may keep earlier result | Skipped unless `@claude review` |
| Codex cloud review | Codex GitHub connection | OpenAI cloud | PR review + inline | Unverified | OpenAI fixed | ChatGPT plan limits; not API key | No | Per trigger setting | Unverified |
| codex-action | Our workflow | Our runner | Our own step posts | Only via our step | OpenAI or Azure endpoint, `model` input | Minutes + API | Self-hosted runner | As triggered | Standard fork rule |
