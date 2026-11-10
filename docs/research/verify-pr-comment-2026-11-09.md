# Passing verify PR comments

Scope: rollout step 4 of [the accepted evidence design](../design/verify-evidence-out-of-tree.md), design PR #3513 and parent issue #3511. The dispatch refines the design's step-id deduplication to one comment per judged head across retries and repeated verifies.

Evidence marks: **Observed** means read or run first-hand in this research session; **Inferred** means derived from those observations. Repository observations use base `7eb99f071db79e7aa6c24dc3393fab6151631325`.

## Prior art

The designated domain is repository automation. Sources covered: GitHub's comment API, Mergify's comment action, and cairn's existing comment action implementation. No merge-queue, workflow, ruleset or branch-protection behavior changes are proposed.

| Source | Mechanism | Trade-off and applicability | Evidence |
| --- | --- | --- | --- |
| GitHub issue comments | Observed: PR conversation comments use the Issues comment endpoint. Creation takes a body and returns HTTP 201; the documented parameters expose no idempotency key. | Inferred: retries after an uncertain response need reconciliation against existing comments. Reuse the existing API bridge. | [GitHub REST](https://docs.github.com/en/rest/issues/comments#create-an-issue-comment) |
| Mergify comment action | Observed: conditions trigger a templated comment; the action can use Mergify's identity or an explicit bot account. | Inferred: conditional delivery fits, but Mergify does not own cairn's bound verdict or build snapshot, so delegating this comment would duplicate state ownership. | [Mergify comment](https://docs.mergify.com/workflow/actions/comment/) |
| Existing cairn review-cap comment | Observed: a message ledger records pending/delivered, an in-flight set serializes delivery, and remote comments from known own identities are searched for a marker before POST. Errors are logged for the next poll. | Inferred: this is the closest existing delivery pattern and covers an accepted POST whose response was lost. Its PR-wide key must become a PR-and-judged-head key for verify. | [deliverReviewCap](../../apps/server/src/services/pr-wakes.ts) |
| Existing cairn attributed GitHub write | Observed: `autonomousToken` prefers the App token and records fallback attribution; `githubComment` and `githubIssueComments` pass through `githubTokenFetch`. `writeJson` surfaces rate limits and failures but does not retry itself. | Inferred: use these services and the existing poll lifecycle, rather than adding a client or transport retry loop. | [token selection](../../apps/server/src/services/github-autonomous-token.ts), [GitHub bridge](../../apps/server/src/lib/github.ts), [token fetch](../../apps/server/src/lib/github-token.ts) |
| Proposed rollout | Inferred: select only attachments-snapshot builds with a passing, fully bound verify verdict for the current judged head and digest; deliver through the existing attributed bridge with the remote head marker as the durable delivery record and an in-flight guard. | Preserves repository-mode behavior and verdict storage; delivery failure remains an independent side effect. | [gate evaluation](../../apps/server/src/services/merge-gate-run.ts), [verdict binding](../../apps/server/src/services/merge-gate/verdict.ts) |

## Recommendation

Use the review-cap delivery pattern at the existing merge-gate evaluation/poll entry point, after digest binding. Read `build.evidenceStore`, never the mutable project setting. Key delivery by team, repository, PR number and judged head, so a new verify step on the same head remains silent and a new head gets a new comment. Read the verdict conclusion from its existing stored output. Include only the verdict, judged head, conclusion and configured web-origin thread URL.

Observed: `persistGateVerdict` stores the verdict before asynchronously binding its digest; `evaluateMergeGate` can complete binding on a later evaluation. Inferred: posting immediately upon raw step completion risks announcing an unbound verdict. Gate evaluation already has the current head and computed digest needed to require an exact match.

Keep the comment result outside the merge verdict. On GitHub failure, leave the stored verdict untouched, log the failure and allow the existing poll to retry. The remote marker is the durable delivery state; no new database field or parallel retry scheduler is needed. Before a retry POST, search remote comments from cairn's known own identities for the same head marker. An unreadable comment list must defer delivery. Use the local in-flight guard as in review-cap delivery; do not hold a SQLite transaction across network I/O.

## Acceptance paths

| Entry path | Expected observation |
| --- | --- |
| First bound passing attachments verify | One text comment contains pass, full judged SHA, conclusion and thread URL. |
| Repeated poll, same step retry, or another verify step on the same head | No additional POST. |
| New head with its own bound passing verdict | One new comment. |
| Failed, extraction-failed, blocked, moved-head or digest-unbound verdict | No POST. |
| Repository snapshot or missing snapshot | No new comment-side reads, writes or ledger state. |
| Project mode changes during a build | Comment still follows the build snapshot. |
| GitHub rejection or lost successful response | Verdict remains stored; poll retries, remote marker prevents duplicates. |

The external documentation was read through agent-reach's Jina Reader route. Its installed CLI rejected `doctor --json`; generic reader requests succeeded. This is source research, not a claim of real GitHub delivery verification.

## Delivery state and implementation decisions

| State | Transition / reader or writer | Failure behavior |
| --- | --- | --- |
| Stored verdict without digest | Existing completion writes the verdict; asynchronous binding and gate evaluation fill the digest. Attachments completion adds its step id to its existing verdict message. | No comment until the head and digest match the gate. Repository message bytes stay unchanged. |
| Eligible, no remote marker | Gate evaluation reads only the build snapshot, bound verdict and matching step message; the in-flight guard serializes the PR/head in this server. | Token/list failure logs and returns; the existing CI sweep retries. |
| POST in progress | Existing attributed GitHub bridge writes one text comment. | Error never mutates verdicts. A lost response is reconciled by reading comments next time. |
| Remote marker present from own identity | Later gate evaluations read the marker and return, including another verify step or build on the same PR/head. | An unreadable or incomplete comment list defers posting. |
| New judged head | A different marker admits one new comment after its own verdict binds. | A stale conclusion is never reused. |

Decision: use the existing `VapidKeys.webOrigin`, populated from server configuration, for the thread URL; retain the existing default origin when the optional dependency is absent. This change adds no repository writes, schema, protocol fields, provider client or retry loop. The remote comment is the sole durable delivery record, avoiding a second ledger that could disagree with GitHub. Reverting this PR removes the side effect without rewriting existing comments or verdicts.
