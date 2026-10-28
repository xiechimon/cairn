# Failure-replay eval bank (#1516)

Confirmed bench questions distilled from plan rejection, review blocking, and
post-merge revert trajectories. Cases live under `cases/` as JSON files.

Candidates are generated with `pnpm traj:failure-replay --generate`, reviewed in
the Langfuse annotation queue (`--enqueue` / human COMPLETED), and only then
written here with `--intake`. Pending candidates never land in this directory.
This path is protected (ADR 0025); intake opens a human-reviewed PR.
