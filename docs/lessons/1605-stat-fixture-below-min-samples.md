---
Category: The statistical-test fixture hand-wrote 4 samples, below the tested function's MIN_PAIRS constant of 5, entering the too-few-samples branch, so the formula assertion failed confusingly
Source: #1605 (2026-10-25)
Level: 2
Safeguard: `integration/test/adoption-judge.test.ts` derives the formula cases' sample size from `MIN_PAIRS` and asserts `degenerate` is null first; negative control: writing `[1, 2, 3, 4]` by hand goes red with `expected 'too_few_pairs' to be null`
Intercepts: 0
Recurrences: 0
Notes: Fixtures for same-kind boundary constants derive from the constant, never hand-written numbers
---
