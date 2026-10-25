# ADR 0015 · Verification evidence stays in the repo: existing content cannot be moved; any relocation decides the increment only

> Status: **superseded** by [ADR 0022](0022-prune-merged-evidence-weekly.md) (2026-10-25). Decided 2026-10-10 from measurements; ticket #1123.
> Trigger: a metrics review proposed moving `docs/verify/` (178M, most of the 264M `.git`) to release assets, Git LFS or a separate evidence repository.

## Problem Statement

A health check saw the 264M `.git` and proposed relocating the evidence directory. The real questions are two, and both must be quantified before answering: ① does a full clone / CI checkout actually hurt, measured? ② would relocation actually save the claimed size?

## Recon facts

| # | Fact | Source |
|---|---|---|
| F1 | Full clone (`--no-checkout`) takes **37s**, .git on disk 209M | measured on this machine 2026-10-10 (two side-by-side clones in /tmp) |
| F2 | `--filter=blob:none` partial clone takes **3s**, .git 3.6M | same as above |
| F3 | The CI `actions/checkout` step is steadily **~9s** (sampled step-by-step across 15 recent successful runs) | `gh api actions/runs`, 2026-10-10 |
| F4 | Merged PR bodies embed **raw permanent links pinned to a SHA**; each link depends on the corresponding blob staying forever in the object store. Deleting `docs/verify/` in a new commit saves no size at all (history keeps it); the only real shrink = a history rewrite = one-shot breaking of every merged PR's evidence chain | git object model; pr-evidence gate criteria (#905/#939/#940, PR #1015) |
| F5 | Relocating to LFS / release assets would change both the delivery surface and the gate's liveness-probe criteria at once (the raw response shape differs); that is a criteria-level change and must re-walk the whole "measure first, then change" pipeline of #939/#940 | same as above |
| F6 | Multi-lane `git worktree add` does not re-download — it shares the local object store and is a local operation; the 37s is the upper bound of the network-side clone, not the daily lane cost | git worktree mechanics |

## Decision

**No relocation.** Verification evidence keeps entering `docs/verify/<ticket>/` with each PR, and PR bodies keep using SHA-pinned raw permanent links. `docs/README.md` already marks that directory "append-only, never relocated".

- **Increment side**: evidence should be "enough to verify", with no hard count gate; bloat is controlled by PR review.
- **Escape hatch** (written for the future person who finds the repo too big): both CI and local can adopt `--filter=blob:none` (F2: 3s / 3.6M) — this is the solution that touches neither the delivery surface nor the gate.
- **Reopen criteria** (numeric, against the next health check repeating the proposal on metrics alone): CI checkout step >60s, or full clone >3min, or .git >1G. Reopen only when one of these is actually measured to fire; the first candidate at reopen is still partial clone, not relocation.
- `docs/research/` (36M, mostly text) is outside this ruling; if it ever needs slimming, evaluate it in a separate proposal.

## Premortem (assuming this ruling is wrong: the three most likely failure modes)

1. Evidence grows at the current rate for another year, `.git` breaks 1G, and clones genuinely hurt → guardrail = the numeric reopen criteria above + the blob:none escape hatch already written into the docs.
2. GitHub changes its raw-large-file / repo-quota policy → guardrail = the pr-evidence gate probes each link alive; the moment policy changes, the gate goes red first — the signal is immediate.
3. "No relocation" is misread as "pile up anything" → guardrail = the increment side is controlled by PR review, and the README states the reason for append-only.
