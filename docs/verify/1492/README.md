# #1492 verification evidence

| file | content |
| --- | --- |
| `shared-unit.txt` | the structure validation (missing-section / empty-talk / passing three classes), the structure-rewrite instruction, the ticket dedup key, and the verify-list reconciliation unit tests itemized |
| `server-gate.txt` | the artifact gate + the structure gate (rewrite once, a still-failing rewrite closes as failed, a passing one goes straight to confirm), the build fallback report, and the full chain from planning → confirm → execution → verify judging per the checklist |
| `integration-real-stack.txt` | a real-process stack (server + daemon + a real pi session + stub LLM): a planning step whose plan carries a Verification section still enters confirm as usual; execution, review, merge, crash recovery and upload recovery do not regress |

Run locally: `pnpm exec vitest run <test file>` (under packages/shared, apps/server and integration respectively).
