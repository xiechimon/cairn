**What it does**

Reviewed exact commit `bdc21db4f4b98d3cac0a8f3a78aba83e2d8e8578` against `d3c8d5039`. It adds a positive safe-integer `--context-window`, rejects selected learn cases, declares the chief model’s window, and records the requested value in results and errors. Source: inspected diff and complete changed source files.

**Good**

- Omission preserves defaults. The existing schema accepts the declaration, and the materializer applies it over `128000` without changing other model entries. Verified at `packages/shared/src/records/provider.ts:23` and `apps/daemon/src/backend/pi.ts:1095–1102`.
- Learn rejection follows case filtering and precedes model execution: `integration/eval/chief-dispatch/run-eval.mts:440–455`.
- The implementation is small, readable, and reuses existing interfaces. No introduced security or meaningful performance concern found by inspection.
- Runtime artifacts correctly limit their claims to local-stub configuration propagation.

**Bad**

**[P2] A missing chief model can produce scored metadata for a window the executing model never received.** The new override targets `opts.chiefModelId` at `integration/eval/chief-dispatch/stack.mts:297–299`, but chief selection falls back to the first roster agent at lines `325–328`. If the default `glm-5.3` is absent and `--model` is omitted, the serving-model check does not run (`run-eval.mts:520`), and the scored row still records `meta.context_window: 1000000` at lines `568–570`.

Measured with extracted source functions and mocked infrastructure: the fallback agent retained `128000`; the extracted worker accepted another served model and recorded `1000000`. The fallback itself exists in base at `stack.mts:313–317`; attributing the new window to that execution is the introduced defect. Reject an unmatched chief model when this option is supplied, or resolve the actual chief before applying and recording its declaration.

**[P2] Error rows record the window even when configuration never materialized.** `integration/eval/chief-dispatch/run-eval.mts:609` unconditionally copies the CLI value after any execution failure, including failure during `bootStack()` or provider creation. This follows directly from the inspected control flow. Record it as `requested_context_window`, or emit the effective field only after confirmed materialization.

**Ugly**

Resume remains keyed only by `(prompt_id, rep)` at `run-eval.mts:429–437,475`. Changing the window can therefore skip old rows or mix configurations in one results file. This is pre-existing resume behavior, not an introduced regression; use a fresh results directory.

The clarity pass found one consequential naming ambiguity: `context_window` currently conflates a request with effective configuration.

**Tests**

- Recorded evidence contains two old-code failures, seven passes, and subsequently 107 passing isolated checks: `docs/verify/1773/context-window-red.log:5–7` and `context-isolated-green.log:5–6`.
- Source and test files are unchanged from recorded source commit `2ca1ade918b3311764874d730e717ca1053c9a91`.
- Independently ran deterministic extracted-source checks under `/mnt/fast/tmp/codex-context-review`: parser validation, omitted declaration, materialization, fallback selection, and scored-row serialization.
- `git diff --check` passed. Full integration suites were not rerun; their cleanup inspects and signals processes, outside the review constraints.
- The committed tests cover the matching-model happy path, not the findings above.

**Open questions**

Should error metadata explicitly describe the requested declaration? That contract needs a distinct name if materialization is unconfirmed.

Real-provider capacity, memory-case qualification, full #1773 acceptance, and the separately approved roster change remain outside this review.

VERDICT: block
