# 1794 in-product merge gate

Automated proof lives in `apps/server/test/merge-gate-product.test.ts`.

- After a GitHub build step finishes, one review step is queued for the team's `code_reviewer` (the default Reviewer; the review slot wins when it is set). The task stays in `building` so CI reconciliation keeps running. A second completion does not queue another review for the same head.
- `evaluateMergeGate` reads GitHub through the gate port, calls `mergeReadiness`, and writes `gate_digest`, `gate_round`, and `gate_state`. The ci-loop sweep calls it for current pull-request builds.
- A patch that touches `apps/server/src/services/merge-gate/readiness.ts` stays not ready with `independent-review-missing` until a review verdict is bound to that head and patch digest, from a different agent on a different model, with `gateLoosening` and `evalRulerChange` answered. An answer of true keeps `review-blocking`. `policy-human` is not introduced. Task detail reads `GET /api/builds/:id/gate` and shows the ready flag, blocker labels, codes, and details.

Not in this change:

- A live pull request has not been merged by a running Cairn yet. That needs this build on the host that dispatches tasks.
- The omarchy review-gate timer stays. Retire it after the in-product gate has handled one week of pull requests with the same outcomes.
- `mergeReadiness` still requires a verify verdict and a chief go/no-go before `ready` is true, in addition to ADR 0026's independent review on protected paths. Those blockers are shown; they are not removed here.
