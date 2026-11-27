# Prior Art: Cutting Preflight Rework via Clean-Rebase Equivalence, Concurrent Review, and Risk-Tiered Review

## Context & Measured Problem

On Cairn (`2026-11-27` live telemetry across the latest 73 commits on `main`, `scripts/ops/preflight-rework.mjs --limit 40` and end-to-end delivery timing measurements):

- **End-to-end landing latency** (measured live): `code done -> main` p50 `44m`, p90 `99m`, while `last rebase -> main` is only p50 `7m` (`preflight -> main` p50 `3m`, `p90` `6m`).
- **Preflight rework breakdown** (measured live, 51 matched landings, 71 preflight CI runs, mean `1.39`, p50 `1`, p90 `3`, max `4`, 20 extra rounds):
  - **Review-fix iterations**: `12 / 20` extra rounds (`60%`, `67m` CI compute + turn-around latency between review & re-preflight).
  - **Clean rebase-only reruns**: `5 / 20` extra rounds (`25%`, `22m` CI compute).
  - **Actual red CI failures**: only `3 / 20` extra rounds (`15%`, `19m`).
  - Overall, **85% (17/20)** of extra preflight runs occur on commits whose previous preflight run had already completed `success`.

## Primary-Source Prior Art

| System | Mechanism | Safety / Equivalence Condition | Relation to Cairn |
| --- | --- | --- | --- |
| **Gerrit Code Review** (`prolog` / submit requirements & `CopyCondition: has:no-code-change` / `changekind:TRIVIAL_REBASE`) | Preserves Verified / Code-Review approvals across patchset uploads on trivial rebases and commit-message edits | Compares `git patch-id` and commit parent movement (`TRIVIAL_REBASE` / `NO_CODE_CHANGE`); conflict edits invalidate approval | Directly applicable to `preflight/*` -> `enqueue/*`: `git patch-id --verbatim` plus forward ancestry check on merge-base preserves preflight admission across clean rebases and `Lane:` trailer stamping |
| **Chromium CQ (LUCI CV)** (`EquivalentPatchsets`) | Reuses completed tryjob verdicts when a new CL patchset is equivalent | Reuse covers only empty commit-message updates or trivial rebases (`parent_changed` with identical diff), never conflict resolution | Same boundary: clean forward rebase or trailer amend reuses preflight admission; any diff change invalidates |
| **GitHub Merge Queue & Bors** | Speculatively tests the merged candidate tree on `gh-readonly-queue/*` / `trying` before advancing `main` | Queue admission is lightweight; production branch ruleset enforces exact-SHA checks on the merged queue commit (`queue/try/*`) | Cairn ALREADY retests rebased/stacked entries on `queue/try/<id>` (`speculative-queue.mjs`) and GitHub `green-main` enforces exact-SHA checks on `main` — preflight was redundantly paying a second full preflight CI on clean rebases even though `queue/try/*` tests the post-rebase tree |
| **Stacked Review + CI Concurrency** (Graphite / Phabricator) | Stamps owner metadata before CI starts so static review runs in parallel with CI | One immutable candidate SHA is tested and reviewed concurrently; findings are applied in one batch commit | Running `preflight.mjs --stamp-only` before launching `preflight.mjs --wait` concurrently with `review-head` eliminates serial review -> re-preflight loops; scaling `review-head` by risk tier avoids 4x overhead on low-risk changes |

## Decision & Gate Updates

1. **Rebase-only preflight reuse (Admission layer only, `green-main` unchanged)**:
   - Extract deterministic `isCleanRebaseOf({ cwd, baseRef, testedSha, headSha })` in `scripts/ops/rebase-equivalence.mjs` requiring: non-empty candidate range, `isAncestor(testedBase, headBase)` relative to `main`, zero merge commits, and identical `(git patch-id --verbatim, %s, %an, %ae)` sequence.
   - `push-queue.mjs` and `speculative-queue.mjs` (`readEntryMeta`) admit a candidate whose tested `preflight/<lane>` ancestor passed `check` + `pack-smoke` + `e2e-gate` with matching `isCleanRebaseOf`.
   - **Critical safety invariant**: `speculative-queue.mjs` guards the `stacksUnchanged` shortcut with `item.exactVerified`, so a rebase-only admitted entry MUST run `queue/try/<id>` CI on its exact rebased tree and can never promote to `main` on the old preflight SHA (`ci-reuse-verified.mjs` for `main`/`preflight/*` and GitHub `green-main` remain exact-SHA strict).
2. **Concurrent review + preflight & risk-tiered `review-head`**:
   - Add `node scripts/ops/preflight.mjs --stamp-only` so `Lane:` trailers are finalized before both `preflight.mjs --wait` and `review-head` start concurrently on the same immutable SHA; review findings are batched into one follow-up commit instead of serial micro-rounds.
   - Scale `review-head` by risk tier (High-risk queue/security/state -> multi-angle; Standard -> single fresh `review-head`; Low-risk docs/CSS/tests -> lightweight diff & claim check).
