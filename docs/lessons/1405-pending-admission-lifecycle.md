---
Category: Autonomous merge admissions were released or retained without authoritative landing state
Source: #1405 (2026-10-30)
Level: 1
Safeguard: Reconcile records landings only at its accepted own-default-branch merge result; recovery never records raw GitHub or local-step landings; accepted API and local report settlement remains idempotent and reconstructs refused admissions; since 2026-10-30
Intercepts: 0
Recurrences: 2
Notes: Review round 3 reproduces 20 reconcile regressions and seven new pending-admission failures before the fix. The rejection matrix covers foreign, fork, wrong-base, missing-base, phase-change and divergent-checkpoint observations, including stale recovery. The accepted late-landing test checks the persisted provider timestamp and one admission. Raw local completed steps cannot bypass report acceptance. Prior evidence is retained.
---
