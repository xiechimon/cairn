# 1794 in-product merge gate

The implementation runs review, verification and a separate chief go/no-go decision through the product step queue. `apps/server/src/services/merge-gate/run.ts` evaluates the existing readiness rules and persists digest, round and state records. The gate decision source lives under the protected merge-gate directory and has only typed I/O ports. `machine-gate-port.ts` and `machine-gate-storage.ts` provide mechanical database, filesystem, credential, HTTP and shared-contract adapters under the existing protected `machine*.ts` category. No protection list or pure-import allowlist changes are needed.

A completed GitHub build queues the default Reviewer once for its head. Review safety answers are associated with the exact step ID. A legacy answer without a step ID, an ambiguous answer, a stopped review, or an absent structured verdict cannot clear independent review. Server claim snapshots the executing agent ID and effective model in the existing step fallback JSON. Review completion and author independence use that execution snapshot, not mutable agent settings. A legacy build without an execution snapshot has an unknown author identity and cannot clear protected-path independence, even when its fallback model is known. Changing the task assignment or agent settings cannot rewrite the recorded author. The snapshot preserves the fallback model, tried-model list and zero-token retry flag.

Once review and verification pass and only `decision-missing` remains, the product queues one read-only review-kind step assigned to the chief with `purpose: decision`. Its prompt includes the reports, head SHA and patch digest. The result is persisted as a decision verdict. A no-go, safety flag, extraction failure, or reported head drift stays blocked. The chief `merge_builds` refusal and the existing human `requestMerge` entry remain in place.

Each evaluation records a redacted JSONL trajectory under `attachments/gate-runs/<build>.jsonl`: reviewer raw session output when available, parsed verdict, model, readiness, status-write outcome and observed merge state. The product writes a commit status; it does not enable or disable GitHub auto-merge, so the action explicitly records `autoMerge: not-requested`. Trajectory export includes these records in `judgments.gate_runs`. The scheduler forwards its attachment directory to the poller. Review-phase reconciliation waits for the gate audit to succeed before marking a merged task done, so a transient issue-write failure is retried on the next sweep. GitHub still reports the PR as merged while this audit is pending.

When GitHub reports a merged head whose last recorded evaluation was blocked, the product opens a `gate-mismatch` issue through the existing GitHub write seam. A PR/head marker deduplicates retries. Tests stub the GitHub port and do not create external issues.

Task detail reads `GET /api/builds/:id/gate` every three seconds while mounted. The browser regression starts with `decision-missing` and observes ready without a page reload.

![Blocked gate in the browser regression](gate-blocked.png)

![Ready gate in the browser regression](gate-ready.png)

The full pre-push run caught an initial attempt to put database/filesystem adapters inside the pure gate directory. Its three import-boundary failures remain the negative control. The current split passes all eight existing import-boundary tests. Step/identity matching, decision scheduling and deduplication, readiness, mismatch decisions and audit marker matching remain in the pure core; the adapters do not choose gate outcomes. `port-protection.txt` records runtime path-classification results for both new adapter files.

Validation recorded during this change:

- CI reconciliation, model fallback and audit-retry regressions: 53 passed. The old audit ordering marked a task done before a failed mismatch-issue write; the current ordering retries the audit before finishing.
- After the port split: CI loop, model fallback, verdict binding, trajectory CLI export and pure-import boundary suites: 116 passed (`port-related-tests.txt`). Product, audit, scheduler and reconciliation suites plus the import boundary: 32 passed.
- Scheduler wiring: the regression failed with an undefined attachment directory and passed after forwarding the configured directory.
- Prompt-echo regression: the old extractor returned `ok` for an echoed passing JSON followed by a final `VERDICT: block`; the current extractor fails closed. Malformed safety verdicts cannot degrade into passing findings or fall back to an older pass; chief decisions require both boolean safety answers. Independent review found this failure and the regression suite covers it.
- Browser regression: the old query stayed on `decision-missing` for ten seconds. The polling query passes with Playwright Chromium. Screenshots above show stubbed API states, not a live task or a real merged PR.
- `pnpm lint`, `pnpm typecheck`, and `pnpm spec:parse` passed. Final pre-push results are recorded separately.

Outstanding host acceptance:

- No live Cairn task PR has merged through this implementation in this environment. This document is local automated evidence and does not satisfy that issue acceptance item.
- Public review publication and autonomous merge execution have not been demonstrated here. The existing human merge API is unchanged.
- The external omarchy review timer remains active. Its retirement requires one week of matching real PR outcomes.
- The existing readiness inputs for the future autonomy pause and daily merge cap are not backed by a production executor in this change. No unattended merge path is enabled.

This change must not close issue #1794 until its host acceptance is complete.
