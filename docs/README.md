# docs/

This directory holds two kinds of things: **long-lived documents** (specs, decisions, processes — changes go through review) and **per-ticket artifacts** (one-off verification evidence and research notes — written, then archived, no longer maintained). Before reading, decide which kind you are in.

## Long-lived documents

| Directory / file | Content |
|---|---|
| `spec/` | Numbered specs that still govern current behavior. The numbering skips retired volumes; `docs/spec/README.md` lists what was removed and where the live contract moved |
| `cairn-plan.md` | Retired. Decisions are written where an agent reads them; do not cite `D…` ids |
| `getting-started.md` | Run the server, enroll a machine, Docker, deploy publicly, build from source |
| `configuration.md` | Every server and daemon environment variable |
| `privacy.md` | What Cairn sends (nothing) and what the optional first-PR discussion prompt does and does not carry |
| `community/welcome.md` | Discussion categories, where bugs and security reports go, and how to post a first-PR write-up |
| `pr-review.md` | The PR review process (five-step process + six-section scorecard) |
| `ops-db-backup.md` | Server DB and attachments backup and recovery (script `scripts/ops/backup-server-db.sh`, the omarchy units, the rrsync receiver on dmit, and drill discipline) |
| `feature-map.md` | Feature coverage: every user-facing feature with its research, frontend design and backend design, the gaps grouped into batches, and eval coverage. Generated from `.claude/skills/verify-cairn/feature-map.json` by `scripts/generate-feature-map.mjs`; do not hand-edit |
| `ops/feature-map-maintain.md` | How the feature registry and the verify-cairn `features/` recipes stay current: the CI check, the daily Actions loop and the live maintain routine |
| `lessons/` | Free-form notes, one file per kind of mistake, recording causes and safeguards |
| `agent-dispatch-prompts.md` | Agent dispatch prompt templates (task, scope, and acceptance commands are appended after the matching template), shared by Codex / Grok / pi, all following AGENTS.md |
| `ops/langfuse.md` | Self-hosted Langfuse v4 on this machine (compose lives in `ops/langfuse/`, not in the product install path) |

## Per-ticket artifacts

| Directory | Content | Discipline |
|---|---|---|
| `verify/<ticket>/` | Removed from `main` on 2026-11-12 | Verify evidence for tasks cairn runs is stored as attachments on the task, and PR screenshots live on `pr-assets/<pr-number>` side branches that never merge. Older documents still name `docs/verify/<ticket>/...` paths; read those files from history: `git log --diff-filter=D --format=%H -1 -- docs/verify/<ticket>` gives the commit that removed the folder, then `git show <sha>^:docs/verify/<ticket>/<file>` |
| `research/` | Research notes archived per ticket (`r*.md`, measurement records) | Archived once written. Cite them as historical material; do not read them as current specs |
