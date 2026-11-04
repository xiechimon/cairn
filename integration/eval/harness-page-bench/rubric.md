# Page benchmark rubric

Authoritative requirement ids come only from `questions.json`. A run record must carry a boolean verdict for every id on the chosen question. This directory defines the contract only; machine grading lands in a later ticket.

## Evidence validity

A run is **invalid evidence** (unscored) when any of the following hold. Invalid is not the same as a failed requirement.

- The record fails `run-record.schema.json`.
- `questionId` or any requirement key is unknown to the question bank version named by `questionBankVersion`.
- Any requirement id from the question is missing from `requirements` (incomplete checklist).
- `screenshots` omit desktop or mobile, use plain path strings, or point at missing or unreadable files.
- Build status, console capture, model, harness version, budgets, elapsed time, token usage, or retries are absent or malformed.

Invalid runs are counted and listed with reasons. They do not enter quality means or cost aggregates.

## Layer 1 machine checks (per valid run)

| Check | Pass rule | Fail / score effect |
| --- | --- | --- |
| Build | `buildOk` is true | Build failure scores 0 for the run |
| Console | `consoleErrors` is empty | Any console error makes the run invalid or scores 0 per the grader ticket; it is never ignored |
| Screenshots | Readable desktop and mobile artifacts with sha256 | Missing viewport evidence is incomplete evidence |
| Requirements | Each bank requirement has a boolean | Missing keys are incomplete evidence; `false` is a failed requirement eligible for partial credit |

Quality for a valid run with a successful build:

`passedRequirements / totalRequirements`

Failed requirements (`false`) reduce the score. They do not invalidate the run when every id is present and other evidence is complete.

## Partial credit

Partial credit applies only to valid runs with `buildOk: true` and a complete requirement map. The score is the fraction of `true` verdicts. An empty requirement map cannot score 1.

## Cost and token usage

Report wall time, input tokens, output tokens, cache read, cache write, and retries from the record. Quality-per-cost uses those fields when they are present and finite. Unavailable or zero-denominator cost data is reported as unavailable; it must not be replaced with raw quality.

## Later layers (out of scope here)

Blind pairwise comparison and Langfuse human calibration consume the same run records and screenshot artifacts. They do not redefine requirement ids or rewrite this bank mid-batch.
