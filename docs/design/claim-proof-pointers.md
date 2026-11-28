# Capability claims carry a proof pointer — plan, 2026-11-28

## User scenario

A reader opens the README, the site home or spec 18 and meets a promise about how Cairn helps: memory from corrections, a repeated mistake turning into a repository check, a protected exam, "kept only if it scores better" (being built), research before code, work on their own machines, and approval before anything irreversible. Today nothing checks that each of those promises still has something behind it: the sentence can outlive the feature, and the 2026-11-28 rewrite already had to delete a merge-gate claim that had been true years earlier. This change makes every such promise carry a machine-checked pointer to the feature-map row or source/test that proves it, so a sentence that loses its proof, or a new promise that gains none, fails pre-flight instead of shipping. The reader sees nothing new on the page; the maintainer sees the failure in `pnpm prepush` and in CI. No account, key or storage is involved.

## Scope

1. Add `docs/claims.json`: one entry per capability claim with a stable `id`, the claim sentence, the surfaces and anchor sentence where it appears, and at least one proof pointer (`feature:<feature-map id>`, a repo source path, or a `test:` path).
2. Mark every claim in the four user-facing surfaces: an HTML comment `<!-- claim: <id> -->` on the claim's line in `README.md`, `README.zh.md` and `docs/spec/18-positioning-and-differentiation.md`, and a `claim: '<id>'` key on every item of the site home's `points.items` in both locales of `site/src/components/copy.ts`.
3. Add `scripts/claim-proof-gate.mjs` with a sibling test: it fails when a proof target resolves to nothing, when a marker names an unregistered id, when a covered README bullet, spec 18 §1.1 capability item or site point item carries no claim (the site message names the locale and the item index), when an anchor sentence has disappeared from its file, or when a registry entry has no proof.
4. Wire the gate into `pnpm prepush` (both the docs-only and the full list) and its test into the prepush self-test list, so the existing CI `check` job runs it; no new workflow or path filter.
5. Keep the claim set limited to the eight capability claims (the seven the 2026-11-28 rewrite introduced plus the evidence-bound gate item carried over in spec 18 §1.1); other prose stays out of scope.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| The deleted two-lists report pitch ("Decided myself" / "Needs your decision") is pasted back into a README bullet without a marker | Pre-flight prints the bullet line and exits 1 instead of shipping the claim | `scripts/claim-proof-gate.test.mjs` | this change |
| A proof pointer names a file or feature id that no longer exists | Pre-flight names the claim id and the missing target | `scripts/claim-proof-gate.test.mjs` | this change |
| A marker names an id absent from `docs/claims.json` | Pre-flight lists the unknown id and its file | `scripts/claim-proof-gate.test.mjs` | this change |
| Someone edits a claim sentence until its anchor text is gone | Pre-flight reports the claim whose anchor no longer occurs in that file | `scripts/claim-proof-gate.test.mjs` | this change |
| A registry entry ships with an empty proof list | Pre-flight rejects the entry before checking any file | `scripts/claim-proof-gate.test.mjs` | this change |
| A site home point item loses its `claim` key while others keep theirs | Pre-flight names the file, line, locale and that item's index | `scripts/claim-proof-gate.test.mjs` | this change |
| A feature-map id is renamed while the claim still cites the old id | Pre-flight fails on the unresolved `feature:` pointer | `scripts/claim-proof-gate.test.mjs` | this change |
| Today's tree | `node scripts/claim-proof-gate.mjs` exits 0 on the real registry and surfaces | `scripts/claim-proof-gate.test.mjs` | this change |
| A repository that never adopted claims (no registry, no markers) | The gate stays quiet, so fixtures and older branches do not fail | `scripts/claim-proof-gate.test.mjs` | this change |
| Markers exist but the registry was deleted | The gate fails on the first marker line instead of passing silently | `scripts/claim-proof-gate.test.mjs` | this change |
| The registry is deleted while a site point item keeps its `claim` key | The gate fails on that item with its locale and index instead of passing silently | `scripts/claim-proof-gate.test.mjs` | this change |
| A new capability item is added to spec 18 §1.1 without a marker | Pre-flight names that item's line; the inventory cannot grow an unchecked promise | `scripts/claim-proof-gate.test.mjs` | this change |

## Done when

- `node scripts/claim-proof-gate.mjs` exits 0 on the real tree, and its test proves each failure mode above, including the deleted "Reports both lists" line.
- `prepushPlan` for a docs change and for a code change both list the gate, and `node --test scripts/prepush.test.mjs` passes with the gate in both plans.
- The four surfaces carry markers: seven README/zh bullets, twelve site home point items, two "how" steps for the research claim, and the spec 18 claim lines including §1.1's three capability items.
- Doc rot is caught, not narrated: the deleted "Reports both lists" claim cannot return unmarked, and no claim line in README, README.zh, spec 18 §1.1 or the site points ships without a pointer to a feature-map row or test.
- The gate's own test fails when run against the parent source (the module did not exist there), which `scripts/regression-inversion-gate.mjs` checks.
- One independent review (fresh context, reviewer model different from the author) has read the plan and the diff.

## Out of scope

- Claims outside the four surfaces (getting-started, comparison guides, eval pages) and every non-capability sentence in the README.
- Checking that the proof itself still works; e2e and unit tests own that, this gate only checks that a pointer exists and resolves.
- Rewriting feature-map rows or adding new features.
- A rendered or hover UI for the pointers; they stay as source comments and JSON.

## Review

- Verdict: CONCERNS
- Plan-SHA256: 7e4308c1e658f8bf3139b27cc6ce769eaa483799e414181d87e8707fa262f84f
- Author-Model: doubao-main-agent
- Reviewer: fresh-context plan review, session 63206227992286722 (read-only worktree access)
- Reviewer-Model: doubao-organizer-reviewer
- Findings: 2 should-fix, 1 nit, all resolved.
  1. should-fix `scripts/claim-proof-gate.mjs` (missing-registry branch): the branch scanned README/zh/spec markers but ignored `claim:` keys in `site/src/components/copy.ts`, so deleting the registry and the HTML markers left the site shipping claims silently. Fixed: the branch now walks the site point items and fails with `site/src/components/copy.ts:<line>: <locale> home point item #<n> keeps claim '<id>' but docs/claims.json is missing`; test "fails when the registry is deleted but a home point keeps its claim key".
  2. should-fix `docs/spec/18-positioning-and-differentiation.md` §1.1: only the README bullets had a claim-line-must-carry-a-marker rule, so a new capability item added to the spec's inventory passed unmarked. Fixed: §1.1's ordered items are a covered section, item 1 carries a new `evidence-gate` claim and item 3 carries `own-machines`; test "fails when spec 18 gains an unmarked capability item". Free prose elsewhere in spec 18 remains anchor-based and is out of scope.
  3. nit `docs/design/claim-proof-pointers.md` Done-when: still cited "the stale merge-gate claim" while the fixture proves the deleted two-lists line. Fixed in Done-when and the edge row.
- Fix-check: PASS
- Fix-check-Plan-SHA256: 624f332f2dca67b6ceb4f66494e28f010eb2521994fcdf2f9aba76b274eb9007
