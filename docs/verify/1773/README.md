# Memory case delivery checkpoint

The original PR head is `6fd985108eb6ce6694ee0e5547c1895625bc217c`. `original-new-cases.json` preserves its new cases. Case `a05` described two deployment commands in the same context while penalizing changes to one. The corrected case distinguishes service startup from database migration and asks for the service startup task. The irrelevant cases now contain background facts rather than directives to change the requested task.

`immutable-memory-red.log` records three actual failures before the preservation fix: changing an adjacent row's title, changing a stale case's unrelated row title, and linking that unrelated row to a successor. Both metrics now use the same comparison of title, content, invalidation, and successor state. `immutable-memory-green.log` records 300 passing cases across grading, actual database seeding, and approval-path binding suites. No assertion or acceptance threshold was relaxed.

The saved chief-dispatch approval hash remains main's existing value after the added push fixture enters both path declarations. Runtime evaluation approval will apply only to an isolated copy of the flow state.

Real-model qualification is pending. Grader controls and seeded database checks do not prove that a case fails on a roster model. A completed scored turn must fail the applicable metric before that new case can qualify under issue #1773. A harness error cannot supply that evidence. This checkpoint has not satisfied that requirement and is not ready to merge.
