# 1794 in-product merge gate

Automated proof lives in `apps/server/test/merge-gate-product.test.ts` and `apps/server/test/merge-gate-verdict-line.test.ts`.

- After a GitHub build step finishes, one review step is queued for the team's `code_reviewer` (the default Reviewer; the review slot wins when it is set). The task stays in `building` so CI reconciliation keeps running. A second completion does not queue another review for the same head.
- `evaluateMergeGate` reads GitHub through the gate port, calls `mergeReadiness`, and writes `gate_digest`, `gate_round`, and `gate_state`. The ci-loop sweep calls it for current pull-request builds.
- Each evaluation with a finished review records a `merge_gate_run` system message: reviewer raw output, parsed `VERDICT:` line, structured outcome, intended action (`auto-merge-on` / `auto-merge-off`), and model id. A parsed line that disagrees with the structured outcome opens a correction issue (deduped per build head).
- `parseFinalVerdictLine` takes the last exact `VERDICT: pass|block` line and fails closed when none exists. A transcript that echoes a prompt naming both outcomes and ends in block is never read as pass.
- A patch that touches `apps/server/src/services/merge-gate/readiness.ts` stays not ready with `independent-review-missing` until a review verdict is bound to that head and patch digest, from a different agent on a different model, with `gateLoosening` and `evalRulerChange` answered. An answer of true keeps `review-blocking`. `policy-human` is not introduced. Task detail reads `GET /api/builds/:id/gate` and shows the ready flag, blocker labels, codes, and details.

Not claimed by this change:

- A live pull request has not been merged by a running Cairn host yet. That needs this build on the host that dispatches tasks, with gate table rows and task-detail evidence committed under this directory.
- The omarchy review-gate timer stays until a week of pull requests match the in-product outcomes.
- `mergeReadiness` still requires a verify verdict and a chief go/no-go before `ready` is true, in addition to ADR 0026's independent review on protected paths. Those blockers are shown; they are not removed here.
- Unrelated to #1405 (autonomous merge executor / `merge_builds`).
