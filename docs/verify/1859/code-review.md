# Code review (branch vs origin/main)

## What it does
Adds `integration/eval/chief-dispatch-real/**` scripts and synthetic tests for a
capability split built from real dispatch failures. Raw cases stay on omarchy;
the repo gets scripts, redaction/label/split tests, and aggregate metrics slots.

## Good
- Tests written first; stubs failed with `not implemented`, then went green.
- Held-out half sealed via `createKeyfileSecretBox`; stdout formatter never
  prints case prompts.
- Labelers receive prompt + options only (no `dispatchedTo`).
- 64-case gate hash pinned; `chief-dispatch/**` untouched.
- `git grep dispatch-real` outside allowed paths is empty.

## Bad
- None blocking.

## Ugly / residual risk
- Omarchy aggregate numbers are still placeholders in metrics.md (no production
  db in this cloud lane). Mechanism is verified synthetically.
- Same-unix-user sealing is not an OS boundary (stated in README and PR Risk).

## Tests
- `chief-dispatch-real-{redact,label,split}.test.ts` and
  `chief-dispatch-unchanged.test.ts`: 11/11 green.
- `pnpm typecheck`, `pnpm lint`, `pnpm spec:parse` green on this change set.

## Open questions
- None.
