# ADR 0026 · Machine trust replaces the human merge gates: autonomous by default, independent review on protected paths, post-hoc sampling

> Status: **Decided** (2026-10-26, ian in the project chat: option A, "learn from poteto", and npm publishing released as well). Supersedes the human-in-the-loop parts of ADR 0021 (D1 default, D4 "forces `human`", D6's npm clause) and spec 28's shadow phase and D7 merge convention. ADR 0021's body is unchanged, per the convention that ADRs are amended by new ADRs, not edited. Everything else in ADR 0021 stays in force: D2 (server-side merge bound to `sha`), D3 (verdicts bound to `patchDigest`), D5 (issue text is data; labels by an owner, a collaborator, or the trusted `claude` app per the 2026-10-25 revision), and D6's deploy ring with automatic rollback. ADR 0025's eval-ruler category stays a protected category under the new rule below.

## Problem Statement

ADR 0021 delegated merge authority per project but kept a person at every point where trust had not yet been measured: `mergePolicy` defaults to `human`, any protected path forces `human` whatever the verdicts say, spec 28 requires a shadow period of at least ten PRs with zero false passes before `autonomous`, ADR and spec changes are merged by the user (spec 28 D7), and npm publishing always keeps a human.

In practice this put ian back on the critical path of every loop iteration. On 2026-10-25 the repository already ran without those clicks: code-owner review was switched off, and a review timer on omarchy runs an independent review agent on every PR that touches a protected path, posts its verdict on the PR, and only then enables GitHub auto-merge. The written rules and the running system disagree, and the written rules are the stricter ones.

The reference practice (poteto, "here's how i shipped 2,500 PRs last month", 2026-09-21, and "my agents now merge their own PRs. i do code review now by looking at what they landed on main") builds trust from machine checks, an independent reviewer that the writer does not control, and after-the-fact human sampling whose corrections become new gates. It does not put a person before the merge.

## Decision

**R1 · Default policy is `autonomous`.** `project.mergePolicy` defaults to `autonomous` for new and existing projects. `human` and `shadow` stay available per project. The team-level `autonomyPaused` emergency stop, the daily merge cap, and the circuit breaker (main turns red after an autonomous merge → pause autonomy and open a revert PR) stay exactly as ADR 0021 and spec 28 P4 define them.

**R2 · Protected paths require an independent review, not a person.** ADR 0021 D4's protected categories (① to ⑤) and ADR 0025's ⑥ keep their globs and their default-deny reading, but hitting one no longer forces `human`. It makes the PR *review-required*: it merges only when

1. every required check is green on the current head;
2. an independent review verdict exists for the current `headSha` and `patchDigest` (D3), from a reviewer that is not the PR's author and runs on a different model than the one that wrote the patch;
3. that verdict explicitly answers two questions in addition to correctness: does the change loosen a gate, a check, or a protected-path list; and does it change how the eval ruler measures (ADR 0025). Either answer "yes" blocks the merge until a further review on a new head says the loosening is justified by the linked issue.

A PR that deletes tests stays review-required under the same rule. The reviewer's verdict is posted on the PR, so the trail is public.

**R3 · No shadow phase.** Spec 28 P8-1 (ten shadow PRs with zero false passes) is dropped. Projects go straight to `autonomous`; the circuit breaker and the emergency stop are the safety net.

**R4 · ADRs and specs merge like other protected paths.** Spec 28 D7 ("the user merges ADRs and design decisions") is replaced by R2. A design change still needs ian's decision first, asked in the chat as the project instructions require; once decided, the PR that records it merges through R2 without a click.

**R5 · npm publishing is automatic.** ADR 0021 D6's last sentence ("npm publishing always keeps a human in the loop") is withdrawn. A release publishes when its version bump has merged through R2 and the release workflow's checks are green.

**R6 · Post-hoc sampling and corrections.** Each week, a sample of merged autonomous PRs (at least five, weighted toward protected paths and large diffs) is sent to ian. Anything he rejects after the fact, and any revert, opens a `correction` issue that turns the miss into the highest feasible guard (spec 28 P6 ladder: code structure, then a lint or CI check, then a rule), validated against the real miss as a negative control.

## Consequences

- ian is no longer on the critical path of any merge. His role is the weekly sample, the emergency stop, and design decisions asked in chat.
- The independent reviewer becomes load-bearing. Its prompt, its model choice and its two mandatory questions belong to the eval ruler's spirit: changes to the review timer's own configuration are themselves review-required.
- A wrong merge is caught after the fact instead of before. The circuit breaker, the revert path, and R6's corrections bound how long a bad change can stay on main.
- Code and docs that still encode the old defaults must follow: the `mergePolicy` default, the merge-readiness gate's `policy-human` / protected-path blockers (protected paths become `independent-review-missing` until a bound verdict exists), the chief's system prompt line "merge actions are only triggered by humans", spec 28's P8 and D7 rows, and the release workflow. These are tracked as implementation issues and land through R2.

## Alternatives considered

- **Delete ADR 0021 outright (option B).** Rejected by ian's choice: it would also drop the patch-bound verdicts (D3), the server-side `sha`-bound merge (D2), the issue-text-as-data rule (D5), and the deploy rollback (D6), which are the machine checks that make unattended merging safe.
- **Keep the human gates and add the review agent on top.** Rejected: it keeps ian on the critical path, which is the problem this ADR solves.
