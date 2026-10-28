# Memory case delivery checkpoint

The original PR head is `6fd985108eb6ce6694ee0e5547c1895625bc217c`. `original-new-cases.json` preserves its new cases. Case `a05` described two deployment commands in the same context while penalizing changes to one. The corrected case distinguishes service startup from database migration and asks for the service startup task. The irrelevant cases now contain background facts rather than directives to change the requested task.

`immutable-memory-red.log` records three actual failures before the preservation fix: changing an adjacent row's title, changing a stale case's unrelated row title, and linking that unrelated row to a successor. Both metrics now use the same comparison of title, content, invalidation, and successor state. `immutable-memory-green.log` records 300 passing cases across grading, actual database seeding, and approval-path binding suites. No assertion or acceptance threshold was relaxed.

The saved chief-dispatch approval hash remains main's existing value after the added push fixture enters both path declarations. Runtime evaluation approval will apply only to an isolated copy of the flow state.

Real-model qualification is pending. Grader controls and seeded database checks do not prove that a case fails on a roster model. A completed scored turn must fail the applicable metric before that new case can qualify under issue #1773. A harness error cannot supply that evidence. This checkpoint has not satisfied that requirement and is not ready to merge.

## Context configuration correction

The real screening from source `aae8a0bcdfb2311c418c2f6229d22d332b338d02` is preserved in `screening-128k.json`. All six irrelevant cases passed, two adjacent cases produced scored failures, and two adjacent turns timed out. Three no-memory controls completed before the task's own evaluation process group was stopped. The provider omitted its context window and the backend used 128000, so none of this batch establishes acceptance under the current 1M requirement.

`context-window-red.log` records two failing CLI controls before the explicit option. `context-window-green.log` records 318 passing cases across five related suites. `context-window-1000000.json` and `context-window-default.json` preserve observations of the daemon's actual model file and the result-row metadata. The provider was a local stub; these artifacts establish configuration propagation without asserting paid-provider reliability.

## Qualification verifier

`check-qualification.mts` reads existing artifacts; it invokes no model and adds no evaluation runner. It checks the source commit, source and arm input hashes, unchanged grading dependencies, approved file fingerprint, model identity, complete scored repetitions, and explicit 1M row metadata. Error rows do not contribute qualifying failures. Every retained new case still needs a completed scored failure, and irrelevant cases need completed no-memory observations. The family counts remain four to six.

`qualification-metadata-red.log` and `qualification-window-red.log` record the negative controls. `qualification-green.log` records 15 passing checks. `old-screening-rejection.log` records rejection of the actual old manifest for missing 1M execution metadata. Provenance declarations alone do not authenticate provider traffic; the observed real run and its limits remain part of the review evidence.

The owner approved the roster change on 2026-10-28. `cases.json` now uses `glm-5.3`, `glm-5.3-flash`, and `deepseek-v4.1-flash`; case contents and grading remain unchanged. `model-roster-proposal.json` preserves the decision and the historical population. The fresh run must cover all twelve retained candidates and the six irrelevant no-memory controls on each model with an explicit 1000000 context window. Results from the old 128k batch cannot qualify a case. The original PR remains blocked pending completed qualification and review.

## Independent context review corrections

The narrow context dependency review found fallback-model and pre-materialization error attribution gaps. The corrected CLI rejects chief models outside the roster before starting a stack when an explicit window is supplied. Error records use `requested_context_window`, which does not claim materialization. Three new controls failed on the old code; 110 related checks passed after correction. The first scorecard and red/green logs are preserved here. The initial approved 1M batch was stopped as incomplete and cannot establish qualification. The next run must use this corrected source and fresh output directories. Independent re-review passed exact context source `365dfd65768a69600e0ad56c074e4b36748a6404`; its final scorecard is `context-independent-followup-review.md`. The memory delivery applies the identical source/test correction at `8e8db4859aac50f6977e6c11c7dd634c373074fb`. The new real batch uses that commit, three approved models, twelve candidates and six paired controls per model, explicit 1000000 context windows, and fresh per-model output directories. The first observed real daemon model files show the selected `glm-5.3` at 1000000; remaining models and completed qualification are not established yet.
