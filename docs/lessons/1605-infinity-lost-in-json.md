---
Category: A number in the verdict structure hit ±Infinity and `JSON.stringify` wrote it as null; the persisted verdict lost the significance digits and read back different from memory
Source: #1605 (2026-10-25)
Level: 2
Safeguard: the "verdict survives a persist-read round trip unchanged" case in `integration/test/adoption-judge.test.ts` covers zero variance, too-few samples and no valid pairings; the structure keeps z finite and carries `meanSign` and `degenerate` fields
Intercepts: 0
Recurrences: 0
Notes: negative control: changing the zero-variance z back to `meanSign * Infinity` turned 4 cases red (including the uniform gain and uniform drop round trips); all 45 green with finite numbers. No structure written to disk may carry Infinity / NaN
---
