# Preventing regressions when many coding agents land in parallel

Date: 2026-11-26
Question: how do teams running many parallel coding agents prevent previously working behavior from being silently broken, using code and CI rather than prose rules?

Labels: **Measured** means I read or ran the cited source/evidence myself in this session. **Inferred** means derived from cited Measured evidence. **Unverified** means unverified or only weakly supported. These English labels correspond to the requested measured/inferred/guess evidence classes; the repository English-only gate prohibits the Chinese label text itself.

## Executive answer

The strongest widely used rung is not a smarter reviewer and not a prose rule. It is a small set of **executable behavioral contracts** that run against the exact candidate tree, plus merge machinery that evaluates those contracts after the candidate is composed with everything ahead of it. For user interfaces, the contract must include both DOM/computed-style assertions and pixel baselines for canonical states; pixel-only and DOM-only checks each miss regressions the other catches. **Inferred** from the Playwright, Chromatic, Argos, Factory, Cognition, Anthropic, Simon Willison, and Caitlin/Imprint evidence below.

For Cairn, the ranked recommendation is:

1. **Land a feature-owned visual/behavior contract gate** for the coordinator chat first, not a generic screenshot dump. The first contract is `coordinator-chat/markdown-code-highlighting`: a deterministic fixture containing a Python fence must assert that keyword tokens receive non-plain computed colors in light and dark themes, and the same state must be pixel-baselined. A fast registry/consistency part belongs in the existing `check-core` job (therefore inside the required aggregate `check`); the browser execution belongs in the existing `e2e`/`e2e-affected` tier and must remain required through `e2e-gate`. **Inferred** from the current Cairn workflow and the prior art.
2. **Land the in-flight `gate-regression` inversion gate**, then widen it beyond `fix(...)` subjects for protected behavior-contract files: a new or changed regression test must fail on the parent source. This is the only deterministic way to prove a test is not a tautology before the fix is applied. **Measured** the lane implements this for light and integration tests in `scripts/regression-inversion-gate.mjs` and wires it into `check-core` plus the integration shard.
3. **Finish and merge the in-flight packaged-journey/visual-baseline lane, but do not treat it as sufficient.** It currently creates six generic surfaces and none is the Coordinator markdown state that just regressed; coverage must be feature-driven and include named states, not only route-level screenshots. **Measured** `gate-packaged-journey` adds `apps/web/e2e/visual-baseline.spec.ts` and `visual-surfaces.json` with workbench/providers/machines/skills/secrets/mcp-servers rows, no coordinator-chat row.
4. Add a **test-integrity diff gate** for protected tests and golden files: deletion, skip/only introduction, assertion-count collapse, expectation replacement, and baseline deletion require an explicit machine-checked migration shape. Use mutation testing selectively on high-risk logic, not as a blanket per-lane gate. **Inferred** from Stryker and Google's mutation-testing-at-scale evidence.
5. Use the feature map as a **lane-partitioning and ownership input** only after contracts exist. File ownership and scopes can serialize risky overlap, but they cannot detect semantic conflicts by themselves. **Inferred** from GitHub CODEOWNERS, Mergify scopes, and semantic-merge research.

The 2026-11-26 highlighting incident is the right first negative control, with one important caveat: the two local PNG pairs named by the brief are currently pixel-identical when decoded, so they cannot validate a pixel gate as-is. The incident must first be re-captured or represented as a deterministic fixture state; otherwise Cairn would once again confuse “screenshots exist” with “the evidence contains the regression.” **Measured** local Pillow comparison, detailed below.

## Cairn evidence examined

| Evidence | What I found | Label |
|---|---|---|
| `/Users/xmon/Pictures/cairn-review/c3-notice-unify/before-chief-messages-light.png` vs `after-chief-messages-light.png` | Both decode to 1440×732. Pixel diff count is 0, bounding box is `None`, and the sampled code-panel colors are identical. Same result for the dark pair. File sizes differ, but pixels do not. | Measured |
| `gate-notice-silent` diff | The lane replaces `UserMessageBubble` and the assistant wrapper with a shared `ChatMessageBody`, and replaces notice/banner components in `apps/web/src/chief/chief-message-rows.tsx` and related files. It adds `apps/web/e2e/notice-line-evidence.spec.ts`. | Measured |
| Current main `chief-d122-visual.spec.ts` | It uses geometric/computed-style assertions (for example a 36px jump button and heading font size/weight), not full pixel goldens. | Measured |
| `.github/workflows/ci.yml` | `check` is an aggregate; `check-core` runs fast gates; `e2e` runs six shards; `e2e-affected` runs selected affected specs; `e2e-gate` aggregates the browser tier. The feature-map consistency check already runs in `gates`. | Measured |
| `gate-regression` in-flight lane | Adds `scripts/regression-inversion-gate.mjs`, flake-ledger machinery, and CI steps. The gate inspects `fix` commits, overlays changed tests onto the parent tree, and fails if those tests pass on the parent. | Measured |
| `gate-packaged-journey` in-flight lane | Adds a packaged-journey registry/gate, a Playwright visual baseline spec, Linux goldens for six surfaces, and a `Visual-Surfaces:` trailer gate for baseline changes. | Measured |
| Existing feature map | `coordinator-chat` is a shipped row owning `apps/web/src/chief`, chief server routes, verification steps, and tests. This is already the right ownership spine for contracts. | Measured |

## Comparison table

### Parallel-agent operating practice

| Source | Mechanism read first-hand | Trade-off / lesson for Cairn |
|---|---|---|
| poteto / pstack, [`correct`](https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/correct/SKILL.md) and [pstack README](https://github.com/cursor/plugins/tree/main/pstack) | **Measured** `correct` says to assume every contributor is an agent seeing only opened files, copying nearby examples, and taking the shortest compiling path. Fix classes in order: architecture, types/lint/CI, behavior tests, docs last. Every new check must be proven to fail on a real past mistake. The README frames pstack as “fearless parallelism” through verifiable code. | Directly matches Cairn's ladder. The important enforcement detail is the negative control: a gate that was never red on the real mistake is not a gate. |
| poteto X article, [`x.com/poteto/article/2094457600259842065`](https://x.com/poteto/article/2094457600259842065) | **Measured** through agent-reach/twitter-cli. Lauren writes that pstack let her ship about 2,000 PRs/month and that, as Grok Bot grew to hundreds of PRs/day, she acted as gardener by monitoring code, refactoring, and adding lints/checks. | Volume makes human-only review impossible; gardening must produce executable constraints. |
| Will Larson / Imprint, [Shipping 100+ PRs to production in a week](https://lethain.com/passing-100-prs-in-a-week/) and [verification pattern](https://lethain.com/adopting-verification-pattern/) | **Measured** Imprint reached 100+ production PRs/week. Bottlenecks moved from structured issues to PR quality, approval, verification, and orchestration. They require `verifications/{pr}.md`, review where verification was impossible, maintain feature maps/tools, and use loops to prune flags, inspect launches, and generate maintenance work. | Verification artifacts help humans allocate review, but the durable win is the maintenance loop that converts verification gaps into tooling. Cairn already has the bones of this in `verify-cairn` and the feature map. |
| Geoffrey Huntley, [multi-boxing](https://ghuntley.com/multi-boxing/) and [the answer to AI is engineering](https://ghuntley.com/answer/) | **Measured** Huntley says parallel agents must not fight; split work into discrete domain units or separate checkouts. In the later engineering talk he argues loops must not close on bad code: use deterministic back pressure such as hooks, static/semantic analysis, NixOS integration tests, and property-based tests. | Worktree isolation is necessary but only prevents simultaneous file writes. Regression prevention comes from deterministic checks over production-like states. |
| Mitchell Hashimoto / Ghostty, [Vibing a Non-Trivial Ghostty Feature](https://mitchellh.com/writing/non-trivial-vibing) and [Zed session](https://zed.dev/blog/agentic-engineering-with-mitchell-hashimoto) | **Measured** Mitchell scopes work narrowly, uses simulations for many update states, manually runs the product, reviews the final diff, and warns not to ship code he does not understand. In the Zed session he says he QA-tests while agents do cleanup and that agents are weak at verifying future regressions without guidance. | Simulation/demo states are valuable because they make rare states reachable. His process is still human-centered; Cairn needs the same state coverage encoded in CI. |
| Simon Willison, [parallel coding agents](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/), [vibe engineering](https://simonwillison.net/2025/Oct/7/vibe-engineering/), [first run the tests](https://simonwillison.net/guides/agentic-engineering-patterns/first-run-the-tests/), [red/green TDD](https://simonwillison.net/guides/agentic-engineering-patterns/red-green-tdd/) | **Measured** Willison says review bandwidth is the natural parallel-agent bottleneck; robust tests, CI, preview environments, git discipline, and manual QA become more important, not less. Red/green TDD must confirm the test fails before implementation, otherwise the test may prove nothing. | Confirms the inversion gate and the need for small, well-specified lanes. Parallelism shifts cost to verification; it does not remove it. |
| Armin Ronacher, [Agentic Coding Recommendations](https://lucumr.pocoo.org/2025/6/12/agentic-coding/) and [Things That Didn't Work](https://lucumr.pocoo.org/2025/7/30/things-that-didnt-work/) | **Measured** Armin recommends simple stable platforms, observable tools, fast deterministic test invocation, managing shared state for parallel agents, and refactoring toward component libraries because scattered UI markup causes major regressions during redesigns. He also warns that automation can cause mental disengagement and regressions are common. | Cairn's unified chat body is exactly the kind of component-library refactor agents should make safer, but only if the component carries executable behavior contracts. |
| Amp team, [The Amp Way](https://ampcode.com/docs/using-amp/how-we-work) and [subagents](https://ampcode.com/docs/models-and-subagents) | **Measured** Amp pushes to main without mandatory human PR review, but says feedback loops are “above everything else”; agents must exercise features end-to-end in dev and production, watch CI/deploys, and finish only when the change is known to work. Subagents are isolated and used for independent areas. | This is the clearest production analogue to Cairn's straight-to-main queue. The missing piece in prose descriptions is exactly what Cairn must encode: which journeys prove which features. |
| Cursor, [Reviewing and testing code](https://cursor.com/learn/reviewing-testing), [Bugbot](https://cursor.com/docs/bugbot), [background agents](https://cursor.com/help/ai-features/background-agents) | **Measured** Cursor says tests/typecheck/lint are verifiable goals; Bugbot can publish a required status but findings default to neutral unless fail-on-unresolved is enabled. Cloud agents attach videos, screenshots, and logs as proof. | AI review is advisory unless deliberately configured as a hard check. Evidence attachments aid review but do not themselves prevent regression. |
| Factory, [Automated QA](https://docs.factory.com/automations/automated-qa), [Missions validation](https://docs.factory.com/missions/planning), [Agent Readiness](https://docs.factory.com/agent-readiness/overview) | **Measured** Factory generates a project QA skill that maps a diff to affected apps, runs only relevant user-like flows, captures screenshots/terminal snapshots/API data, posts a report, can be a required CI check, and feeds newly learned failure patterns back into the QA skill. Missions validate by driving the running app. | Closest productized feature-journey model. Cairn should implement the deterministic parts itself rather than depend on an agent deciding what to test each time. |
| Cognition / Devin, [Verifying Agentic Development at Scale](https://cognition.com/blog/testing-development) and [prompting docs](https://docs.devin.ai/learn-about-devin/prompting) | **Measured** Devin spins up apps in parallel cloud VMs, writes a source-grounded test plan before computer-use testing, annotates expected assertions before acting, uses deterministic scripts for repeated setup such as login, returns screenshots/video/pass-fail assertions, and treats cheating through programmatic browser manipulation as a hard edge. | Two lessons transfer: commit to expected observable behavior before interaction, and convert expensive setup into deterministic scripts. The test plan itself should become a persistent contract, not be regenerated every lane. |
| Anthropic Claude Code, [best practices](https://code.claude.com/docs/en/best-practices) and [worktrees](https://code.claude.com/docs/en/worktrees) | **Measured** The docs distinguish non-deterministic instructions (prompts, CLAUDE.md, skills) from deterministic enforcement (hooks, deny rules, tests, CI). They say “looks done” is all a model has without a pass/fail check; checks can be tests, exit codes, fixture diffs, or browser screenshots. Worktrees isolate file edits. | This is the strongest first-party statement for the core conclusion: prose cannot guarantee behavior; CI/hooks must own invariants. |
| OpenAI Codex, [Introducing Codex](https://openai.com/index/introducing-codex/) and [best practices](https://learn.chatgpt.com/guides/best-practices) | **Measured** Codex tasks run isolated in parallel cloud sandboxes, can run tests/linters/typecheckers, return terminal logs and test outputs as evidence, and perform best with configured environments, reliable tests, and clear “done when” criteria. | Isolation plus evidence is table stakes. The repository still needs a machine-readable definition of done. |

### Visual regression gates

| Source | How diffs gate and approvals work | Fit for Cairn |
|---|---|---|
| [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots) | **Measured** `toHaveScreenshot()` creates golden files on first run, compares later runs, updates with `--update-snapshots`, names snapshots by browser/platform, and warns rendering differs by OS/settings/hardware/headless mode. Pixelmatch exposes `threshold`, `maxDiffPixels`; snapshots should be committed and reviewed. | Best fit because Cairn already uses Playwright and Linux CI. Goldens must be generated on Linux CI or in the same docker/browser environment. It can catch color loss only if the fixture actually contains highlighted code and the capture timing waits for highlighting. |
| [Chromatic PR workflow](https://www.chromatic.com/docs/in-pull-request/), [mandatory checks](https://www.chromatic.com/docs/mandatory-pr-checks/) | **Measured** UI Tests compare stories with accepted baselines; intended changes are accepted to update baselines; once all are approved the check passes. Checks can be required so visual changes cannot merge unapproved. | Mature approval model, but external service, baseline state outside git, and human approval queue. Poor fit for Cairn's straight-to-main autonomous queue unless approvals are automated/agent-owned. |
| [Percy approval workflow](https://www.browserstack.com/docs/percy/visual-testing-workflows/view-percy-build-results/approval) and [GitHub integration](https://www.browserstack.com/docs/percy/integrations/source-control/github) | **Measured** Percy updates commit/PR status for processing, visual changes, approval, and requested changes. Builds can be merge blockers; approvals carry forward per branch. | Same trade-off as Chromatic. Useful prior art for review states, less suitable as the first Cairn gate. |
| [Argos GitHub integration](https://argos-ci.com/docs/learn/integrations/github-integration) and [build modes](https://argos-ci.com/docs/learn/platform-fundamentals/build-modes) | **Measured** Argos selects a baseline from Git ancestry, reports commit statuses, blocks when required, and approved builds become future baselines. It supports merge-queue runs. | Conceptually strongest SaaS fit because baseline selection is git-aware, but still external state and approval flow. |
| [Lost Pixel workflow](https://docs.lost-pixel.com/user-docs/guides/testing-workflow-github-actions) and [baseline updates](https://docs.lost-pixel.com/user-docs/guides/testing-and-updating-baseline-locally) | **Measured** OSS mode is simple: green when current images match baselines, red when they differ; intended changes require updating baseline images and committing them. An action can open a baseline-update PR. | Closest to a git-native gate. Playwright already gives Cairn the same mechanics with less new tooling. |

### Test integrity, mutation, and executable specifications

| Source | Mechanism | Fit for Cairn |
|---|---|---|
| [Stryker mutation testing](https://stryker-mutator.io/docs/) and [mutant states](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/) | **Measured** Mutation testing inserts small faults and runs tests. A mutant is killed when a test fails, survives when tests pass; mutation score is detected mutants divided by total valid mutants. `perTest` coverage analysis can run only covering tests. | Strong measure of assertion quality but expensive and noisy for UI behavior. Use diff-scoped or high-risk module runs, not the main per-lane gate initially. |
| Google, [Practical Mutation Testing at Scale](https://arxiv.org/html/2102.11378v2) and [Google Testing Blog](https://testing.googleblog.com/2021/04/mutation-testing.html) | **Measured** Google made mutation testing tractable by mutating only changed code during review, filtering irrelevant mutants, limiting mutants per line/review, and selecting operators by historical usefulness. Deployment reached more than 24,000 developers on 1,000+ projects. | The scalable pattern is diff-scoped findings, not whole-repo mutation. For Cairn, apply to selected high-risk server logic after behavior contracts are stable. |
| [Long-term effects of mutation testing](https://research.google/pubs/long-term-effects-of-mutation-testing/) | **Measured** Analysis of almost 15 million mutants found developers exposed to mutation findings wrote more tests and improved suites so fewer mutants remained. | Evidence that mutant feedback changes behavior, but not evidence it should block every lane. |
| Anthropic TDD workflow, [Claude Code best practices](https://www.anthropic.com/research/claude-code-best-practices) | **Measured** Anthropic recommends writing tests first, confirming they fail before implementation, then implementing without modifying tests, optionally using independent subagents to detect overfitting. | This is a workflow rule; Cairn's inversion gate turns the critical red-first assertion into CI. |
| poteto [`test-behavior-not-implementation`](https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/principle-test-behavior-not-implementation/SKILL.md) | **Measured** A test must fail when observable behavior breaks and survive implementation-only changes. Loose assertions and expected values computed by the implementation prove nothing. | This gives the exact rubric for the proposed contract: assert visible token colors and user-visible states, not component presence. |

### Merge-time composition, ownership, and semantic conflicts

| Source | Mechanism | Fit for Cairn |
|---|---|---|
| GitHub [merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) and [rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets) | **Measured** GitHub creates speculative `merge_group` branches containing base + preceding PRs, requires checks on that group, ejects failing/conflicting PRs, and rebuilds downstream groups. | Cairn already implements the important property in its own speculative queue. The queue only catches what executable tests cover; it is not a semantic conflict detector by itself. |
| GitHub [CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) | **Measured** CODEOWNERS routes required review and is read from the base branch. It does not prevent overlapping writes. | Useful as review routing, weak as an agent control. Cairn's feature map is richer because it links behavior, code, verification, and evidence. |
| Mergify [queue modes](https://docs.mergify.com/merge-queue/queue-modes/) and [scopes](https://docs.mergify.com/configuration/scopes/) | **Measured** Mergify supports serial, parallel, and isolated queues. Parallel mode uses declared file-pattern scopes so batches sharing a scope serialize while disjoint scopes proceed; `all_scopes` acts as a barrier. Docs describe this as preventing semantic conflicts. Speculative checks and batching trade reliability/cost/velocity. | Strong prior art for scope-aware scheduling. File-glob scopes are a syntactic proxy; Cairn's feature map could be a better behavior-oriented scope key, but that is unproven. **Inferred** |
| SAM semantic merge study, [JSS 2024](https://doi.org/10.1016/j.jss.2024.112070) | **Measured** abstract: generated unit tests act as partial behavior specifications for merged changes; best configuration detected 9 of 29 real semantic conflicts in the study dataset. | Even research-grade detection misses most conflicts. Production protection must come from intentionally authored behavioral contracts. **Inferred** |
| Semex, [FSE 2015](https://dl.acm.org/doi/10.1145/2786805.2803208) | **Measured** abstract: variability-aware execution detected all 19 semantic conflicts in 7 PHP programs. | Small-scale, specialized infrastructure; not a practical Cairn gate. **Inferred** |
| Static interference analysis, [arXiv 2310.04269](https://arxiv.org/abs/2310.04269) | **Measured** abstract reports 20 true positives, 26 false positives, 13 false negatives, 40 true negatives on 99 experimental units. | Too noisy for a blocking gate. **Inferred** |

## Root-cause classes of agent regressions

| Class | How it appears | Evidence | Best control |
|---|---|---|---|
| 1. Missing executable behavior contract | A refactor compiles and visible-element tests pass, but a user-visible property disappears (syntax highlighting, formatting, ordering, interaction). | **Measured** Cairn incident brief and current geometric tests; **Measured** Cognition says clean review alone is insufficient and end-to-end proof is needed; **Measured** Anthropic says “looks done” is all a model has without a pass/fail check. | Persistent per-feature contracts driven in a real browser/app, tied to feature-map rows. |
| 2. Tautological or weakened regression test | A test passes both before and after the fix, asserts presence rather than behavior, or is edited to match broken output. | **Measured** Simon Willison and Anthropic both require red before green; **Measured** poteto says a test that still passes when behavior breaks proves nothing. | Inversion gate: test must fail on parent. Test-integrity diff checks. |
| 3. Test deletion or scope shrink | A lane deletes a test, introduces skip/only, weakens exact equality into truthiness, or removes a golden while keeping the feature. | **Measured** this failure mode is explicitly called out in the brief and in the in-flight Cairn lanes; **Inferred** it follows from agents optimizing for green CI. | Protected-file diff gate plus mutation/testing-quality metrics. |
| 4. Evidence theater | Screenshots/logs exist but do not contain the failing state, are not compared, or are identical before/after. | **Measured** the named Cairn before/after PNG pairs are pixel-identical. **Measured** Cursor/Devin/Factory emphasize artifacts, but artifacts alone are not gates. | Machine comparison against baselines and artifact-fidelity checks. |
| 5. Local-context optimization | An agent sees only nearby files, copies the nearest pattern, and loses another lane's or feature's intent. | **Measured** poteto `correct` premise; **Measured** Armin warns context management is unreliable and shared read/write parallelism creates chaos. | Architecture with one owner per behavior, feature-map ownership, lane overlap serialization. |
| 6. Merge-time semantic interaction | Two lanes pass independently, merge textually, and jointly break behavior. | **Measured** GitHub/Mergify queues validate composed states; **Measured** semantic-merge literature shows textual/compile success does not imply intended behavior. | Speculative queue plus feature contracts executed on the composed tree. |
| 7. Refactor without preserving observational equivalence | Unifying components changes props/classes/hooks or drops async rendering behavior because no fixture exercises every state. | **Measured** the Cairn unification diff touches shared chat body and notice rendering; **Measured** Armin says component libraries become necessary because scattered markup causes major regressions in redesigns. | State-matrix fixtures and visual/computed contracts for every component state before unification. |
| 8. Flaky or untrusted suite | Teams respond by weakening assertions, retrying blindly, or ignoring red. | **Measured** `gate-regression` introduces a flake ledger; **Inferred** flaky tests otherwise train agents and humans to discount failures. | Quarantine flakes deterministically, fix or delete them, never use broad pixel thresholds to hide them. |

## Recommended Cairn gate in concrete terms

### Gate name and ownership

`feature-visual-contract-gate`, initially covering only `coordinator-chat` and expanding row by row.

The feature map row gains a machine-readable contract list conceptually like:

```json
{
  "id": "coordinator-chat",
  "contracts": [
    {
      "id": "markdown-code-highlighting",
      "kind": "visual+computed",
      "surface": "chief-md-ref",
      "themes": ["light", "dark"],
      "spec": "apps/web/e2e/coordinator-chat-contracts.spec.ts",
      "baseline": "apps/web/e2e/coordinator-chat-contracts.spec.ts-snapshots/chief-markdown-{theme}-linux.png"
    }
  ]
}
```

The exact schema can be simpler; the important part is that contract ownership is data, not prose. **Inferred**

### What the first contract must assert

For a canonical Coordinator markdown fixture containing at least a Python fence, a table, nested list, quote, link, task states, and attachment-like content:

1. The code block exists and has finished tokenizing. Wait for a deterministic ready condition, not a timeout. **Inferred** from Cognition's timing hard edge.
2. At least one keyword token (`from`, `import`) has a computed color different from plain body text and different in the light/dark token theme. This catches loss of syntax highlighting even if pixels shift for unrelated reasons. **Inferred**
3. Screenshot the exact canonical region/full page in both themes and compare to Linux goldens. This catches layout/color regressions that computed assertions did not name. **Measured** Playwright supports this directly.
4. Assertions must use the public rendered DOM/computed style, not Shiki internals. **Measured** poteto behavior-test rubric.

### Where it runs

| Layer | Existing job | Content | Expected cost/latency |
|---|---|---|---|
| Fast consistency gate | `check-core`, therefore part of required aggregate `check` | Validate registry shape; every contract file/spec/baseline exists; protected baselines are not deleted; modified baselines carry an explicit surface declaration; changed feature-owned UI files have at least one current contract row. | **Inferred** under 1–5 seconds because it is file/registry inspection, matching the in-flight lane's static gates. |
| Browser contract execution | existing `e2e-affected` when chat/markdown files change; existing full `e2e` shard for canonical coverage | Launch the existing fixture app, visit the canonical scenario, wait for ready state, run computed assertions and `toHaveScreenshot`. | **Inferred** roughly the cost of one Playwright spec (tens of seconds to a few minutes), not a new CI tier. The current workflow already pays browser setup in these jobs. |
| Negative-control validation | local/CI self-test of the gate script, not production runtime | The gate's own unit test materializes the parent/buggy tree and requires the contract to fail there, then pass on the fixed tree. | **Measured** `gate-regression` already uses parent-tree materialization and targeted test execution; cost is bounded by the targeted spec. |

### Negative control for the 2026-11-26 highlighting loss

Required acceptance evidence before enabling enforcement:

1. Reproduce the buggy state on the pre-fix/unified implementation in the same Linux/browser environment used by CI. **Inferred**
2. Show the new contract red there because the keyword token computed color equals plain text or because the pixel diff exceeds the tight threshold. **Inferred**
3. Show the same contract green on the fixed tree. **Inferred**
4. Archive the red output and actual/expected/diff images as CI artifacts. **Measured** Playwright produces actual/diff artifacts on mismatch; Chromatic/Argos/Percy all treat reviewable diffs as the central artifact.

Caveat: the owner's local PNG paths currently cannot serve as this proof because both pairs are pixel-identical after decoding. This may mean the capture race missed the tokenization difference, the wrong state was captured, or the regression report refers to a different state/commit than the captured fixture. **Inferred** from the Measured pixel comparison. The correct response is not to lower confidence in visual gates; it is to treat artifact fidelity itself as part of the gate design.

## Overlap with in-flight lanes

| Lane | What it already covers | Gap this research leaves for it |
|---|---|---|
| `gate-regression` (`c3f5a2e41`) | **Measured** Enforces red-on-parent inversion for `fix` commits with changed tests; separates light/integration modes; introduces a flake ledger. | Does not cover feature/refactor commits that accidentally break behavior, because it keys on `fix` subjects. Does not protect golden files or computed visual behavior. Keep its scope; compose it with the visual contract gate rather than overloading it. |
| `gate-packaged-journey` (`f1bae0bc0`) | **Measured** Adds packaged-journey coverage requirements for feature-owned diffs and visual baselines for six generic surfaces; validates baseline deletion and `Visual-Surfaces:` declarations. | Its visual registry currently lacks coordinator-chat and named component states. Its route-level screenshots are broad and therefore vulnerable to noisy unrelated diffs. The research recommendation is to keep the mechanism but prioritize feature-owned canonical states, starting with markdown highlighting. |
| `gate-notice-silent` (`ac45a9ae4`) | **Measured** The unification lane that motivates this research. | It should not land until the Coordinator markdown contract is red on the regression state and green on the fixed state. If the alleged highlighting loss cannot be reproduced, that fact must be documented and the correct negative control replaced. |

## Cost, latency, and operational risk

| Choice | Cost/latency | Risk |
|---|---|---|
| Playwright contract in existing e2e | **Inferred** one additional spec in existing browser jobs; marginal per-lane cost after browser setup is already paid. Registry check is near-free. | Baseline flake from fonts/ASync rendering. Mitigate with Linux-only goldens, fixed time/data, disabled animations, font readiness, strict environment, and no broad thresholds. |
| Chromatic/Percy/Argos | **Inferred** snapshot upload + remote rendering + human/agent approval latency; external service dependency and possible usage cost. | Approval queue conflicts with autonomous straight-to-main flow. Baselines live outside the candidate diff, making provenance weaker. |
| Lost Pixel OSS | **Inferred** similar to Playwright goldens, plus another tool and docker baseline workflow. | Duplicates existing Playwright capability. |
| Mutation testing | **Measured** Google needed incremental changed-code mutation and heavy filtering to scale. **Inferred** targeted mutation costs one or more test runs per mutant. | Too expensive/noisy as a universal lane gate. Use in high-risk logic or scheduled gardening first. |
| Lane-overlap serialization | **Inferred** queue admission inspection is cheap. | File overlap is not semantic overlap; false positives reduce throughput. Use as ordering/hint before making it blocking. |

## Sources blocked or incomplete

- Reddit: **Measured** agent-reach/OpenCLI search returned `LOGIN_WALL` / HTML 403. No Reddit claim is used in this report.
- Hacker News: **Measured** Algolia API search found relevant threads including `Show HN: A local merge queue for parallel Claude Code agents` (`https://news.ycombinator.com/item?id=49104747`) and parallel-agent tooling threads, but I did not use comments as evidence for the recommendation because primary practitioner/vendor evidence was stronger.
- X/Twitter: **Measured** agent-reach/twitter-cli authenticated successfully as Ian and read poteto's article/post metadata. Other X claims are not used unless backed by a linked blog/docs source.
- The Cognition, Factory, Cursor, Amp, and OpenAI sources are vendor self-descriptions. Their mechanism descriptions are **Measured** as documentation; their effectiveness claims are **Inferred** unless independently supported here.

## Bottom line

Cairn already has the merge machinery most teams are still building. The missing strongest rung is not another review agent or a broader instruction file. It is a durable, feature-owned contract suite whose negative controls are proven red on real past regressions and whose execution is mandatory on the same composed candidate that lands on `main`. Start with the exact behavior that just escaped: Coordinator markdown code highlighting. **Inferred**
