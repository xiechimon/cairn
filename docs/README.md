# docs/

This directory holds two kinds of things: **long-lived documents** (specs, decisions, processes — changes go through review) and **per-ticket artifacts** (one-off verification evidence and research notes — written, then archived, no longer maintained). Before reading, decide which kind you are in.

## Long-lived documents

| Directory / file | Content |
|---|---|
| `spec/` | Numbered specs (test layering, PR process, etc.); the canonical text of the engineering rules |
| `adr/` | Architecture decision records (ADRs), ordered by number; decided matters are not re-debated in review, and overturning one takes a new ADR |
| `pr-review.md` | The PR review process (five-step process + six-section scorecard) |
| `ops-db-backup.md` | Server DB backup and recovery (script `scripts/ops/backup-server-db.sh`, schedule template, and drill discipline) |
| `feature-map.md` | Feature map (living register of current state), mechanically extracted by `scripts/generate-feature-map.mjs` — do not hand-edit; re-run the script to regenerate, add `--check` to verify |
| `lessons/` | Error ledger (one file per error category of things that went wrong and were later fixed); protections take the highest feasible level on the ladder, and anything that can be made a machine check must not stop at prose |
| `agent-dispatch-prompts.md` | Agent dispatch prompt templates (task, scope, and acceptance commands are appended after the matching template), shared by Codex / Grok / pi, all following AGENTS.md |
| `ops/langfuse.md` | Self-hosted Langfuse v4 on this machine (compose lives in `ops/langfuse/`, not in the product install path) |

## Per-ticket artifacts

| Directory | Content | Discipline |
|---|---|---|
| `verify/<ticket>/` | Verification evidence committed with each PR (screenshots, probe output, mechanism diagrams) | Lands with its PR; a weekly run removes folders older than 14 days from `main` and records their last commit in `verify/pruned.json` (`git show <sha>:docs/verify/<ticket>/`). Merged PR bodies keep working because their raw links pin a commit. Decision: [`adr/0022-prune-merged-evidence-weekly.md`](adr/0022-prune-merged-evidence-weekly.md) |
| `research/` | Research notes archived per ticket (`r*.md`, measurement records) | Archived once written. Cite them as historical material; do not read them as current specs |
