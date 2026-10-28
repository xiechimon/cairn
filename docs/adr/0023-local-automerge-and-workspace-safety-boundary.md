# ADR 0023 · Local-form autonomous merge and the workspace safety boundary

> Status: **Decided** (2026-10-24, ian set the principle "one chief, code must pass the gates, opening a PR is only how code lands"). Issue #1625. Amends the scope of ADR 0021 (extended to local projects) and the wording of #1211; it does not change ADR 0021's D4 criteria.

## Decision

Local projects support `mergePolicy = human | shadow | autonomous`, just like GitHub projects. The default is whatever ADR 0026 R1 sets for every project kind; this ADR does not fork it. Existing behavior for `human` is unchanged.

Autonomous merging still goes through ADR 0021's merge-readiness gate and D4 criteria first. For local projects, the patch summary is produced by the machine hosting the repository running `git diff <base>...<head>`; the summary tuple, evidence-directory exclusion rules, and recomputation requirements are identical to the GitHub version. Before merging, re-read the default-branch head; if it differs from the base used at decision time, or the recomputed summary differs, re-evaluate.

The autonomous executor is the daemon on the machine hosting the repository. The server issues the merge command and records the result; the daemon creates a squash merge commit. All of the project config's local check commands must pass before autonomous merging may proceed.

## #1211 safety boundary

- The daemon may advance the default branch to the squash commit only when the user's main checkout is on the default branch and the working tree is clean.
- When the user has checked out another branch, only the default-branch ref is updated; the user's working tree is not touched.
- When the working tree has uncommitted changes, or the checkout is on the default branch but the tree is dirty, the merge is suspended and the user is notified; the working tree is not modified.
- When the current checked-out branch cannot be determined, the merge is suspended and the user is notified.

## Relationship to ADR 0021

The D4 protection categories and the auto-mergeable set are reused as-is. Local only swaps D2's execution site from the server's GitHub REST surface to the daemon on the machine hosting the repository; the criteria do not fork into a separate system. ADR 0021's `human` default as amended by ADR 0026 R1, and #1211's main-checkout safety boundary, continue to apply.
