---
Category: A statistical test fixture hand-wrote 4 samples, below the function-under-test's MIN_SAMPLES constant of 5, so it entered the too-few-samples branch and the formula assertion failed with a confusing message
Source: #1605 (2026-10-25)
Level: 2
Safeguard: sample sizes in the formula cases of `integration/test/adoption-judge.test.ts` derive from `MIN_PAIRS`, and the cases first assert `degenerate` is null; negative control: reverting to a hand-written `[1, 2, 3, 4]` goes red with `expected 'too_few_pairs' to be null`
Intercepts: 0
Recurrences: 0
Notes: test fixtures for boundary constants derive from the constant, never hand-write numbers
---
