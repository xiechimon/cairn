---
Category: Numbers in the verdict structure reached ±Infinity, `JSON.stringify` wrote them as null, the persisted significance numbers were lost, and the verdict read back differed from the one in memory
Source: #1605 (2026-10-25)
Level: 2
Safeguard: `integration/test/adoption-judge.test.ts`'s "the verdict read back from disk equals the original exactly" case covers zero-variance, too-few-samples, and no-valid-pairs boundaries; the structure now keeps z always finite with `meanSign` and `degenerate` fields
Intercepts: 0
Recurrences: 0
Notes: Negative control: writing zero-variance z back as `meanSign * Infinity` turns 4 cases red (including the uniform gain and uniform drop disk read-backs); all 45 green after making it finite. Structures that go to disk must not hold Infinity / NaN
---
