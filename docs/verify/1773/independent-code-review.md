Checkpoint reviewed: `aae8a0bcdfb2311c418c2f6229d22d332b338d02` against `origin/main` at `e8f0da94c96ea6dd68d638ef987ea7b170a900a6`.

**What it does**

Adds six adjacent-memory and six irrelevant-memory cases to the existing runner, and strengthens preservation grading. Reviewed the complete diff, full changed code files, original archive, issue/PR bodies, and association-filtered comments through authenticated `gh api`.

**Good**

- Observed: both preservation metrics require unchanged title/content and exactly null `invalidAt`/`supersededBy` in [grade.mts:87](https://github.com/xiechimon/cairn/blob/aae8a0bcdfb2311c418c2f6229d22d332b338d02/integration/eval/memory-regression/grade.mts#L87).
- Observed: `a05` now separates service startup from database migration. The irrelevant memories describe background facts rather than instructing the requested task.
- Verified: all 21 existing cases remain unchanged; the original 12-case archive matches the original PR head exactly.
- Verified: chief-dispatch harness path declarations match, include `push.md`, and preserve the saved approval hash. Recomputing the current harness hash rejects that stale approval.
- Observed: decision grading and the chief-dispatch acceptance threshold are unchanged.

**Bad**

No implementation correctness or maintainability defects found. The new cases have distinct requested and preserved scopes; the assertions were not treated as substitutes for those semantics.

**Ugly**

No security or performance defects found in the changed code. Source inspection shows separate per-case stacks; the shared push fixture contains no conflicting instruction for existing chief-dispatch cases. Its possible effect on model behavior remains unverified.

**Tests**

- This review ran **84 isolated deterministic grading checks**, covering preservation success and rejection of deletion, title/content edits, invalidation, and successor links.
- Checkpoint artifacts record three failing controls before the fix and **300 focused tests passing afterward**. Those are recorded delivery results, not a fresh 300-test run here.
- **Real-model qualification remains unverified:** no current evidence establishes a scored baseline failure for every retained new case, case difficulty, or paired no-memory behavior. Repository answer markers do not establish behavioral equivalence.
- The historical roster diagnosis and historical PASS were not used as current acceptance evidence.

This verdict judges implementation correctness only. It is not merge authorization; real-model qualification remains pending.

VERDICT: pass
