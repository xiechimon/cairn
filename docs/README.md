# docs/

Every document here is either **living** or a **record**. Decide which before reading.

- **Living** documents must be true today: the root `*.md` files, `docs/*.md`, `docs/spec/`, `docs/ops/`, the project skills under `.claude/skills/` (not their vendored, reference or changelog files), `apps/web/DESIGN.md`, the `## Rules` sections of `docs/design/surfaces/*.md`, and the landing mechanics in `docs/design/tested-sha-landing.md` and `docs/design/preflight-ci-verification.md`.
- **Records** were true on their date. They are not maintained and are never current behaviour: `docs/research/`, `docs/lessons/` and everything else under `docs/design/`. A status line in a record describes the day it was written. A rule in a record that still governs behaviour moves into a living document.

The change that retires a mechanism, path or rule updates or deletes every living document that describes it. Records stay as they are.

## Living documents

| Directory / file | Content |
|---|---|
| `spec/` | Numbered specs that still govern current behavior. The numbering skips retired volumes; `docs/spec/README.md` lists what was removed and where the live contract moved |
| `getting-started.md` | Run the server, enroll a machine, Docker, deploy publicly, build from source |
| `configuration.md` | Every server and daemon environment variable |
| `privacy.md` | What Cairn stores locally, how task session records are handled, and what configured integrations or optional services send |
| `community/welcome.md` | Discussion categories, where bugs and security reports go, and how to post a first-PR write-up |
| `ops-db-backup.md` | Server DB and attachments backup and recovery (script `scripts/ops/backup-server-db.sh`, the omarchy units, the rrsync receiver on dmit, and drill discipline) |
| `feature-map.md` | Feature coverage: every user-facing feature with its research, frontend design and backend design, the gaps grouped into batches, and eval coverage. Generated from `.claude/skills/verify-cairn/feature-map.json` by `scripts/generate-feature-map.mjs`; do not hand-edit |
| `ops/feature-map-maintain.md` | How the feature registry and the verify-cairn `features/` recipes stay current: the CI check, the daily Actions loop and the live maintain routine |
| `lessons/` | Frozen archive of past mistake notes. Do not add files; the `retro-cairn` skill records a safeguard in the code it concerns |
| `agent-dispatch-prompts.md` | Agent dispatch prompt templates (task, scope, and acceptance commands are appended after the matching template), shared by Codex / Grok / pi, all following AGENTS.md |
| `ops/langfuse.md` | Self-hosted Langfuse v4 on this machine (compose lives in `ops/langfuse/`, not in the product install path) |

## Records and per-ticket artifacts

| Directory | Content | Discipline |
|---|---|---|
| `verify/<ticket>/` | Removed from `main` on 2026-11-12 | Verify evidence for tasks cairn runs is stored as attachments on the task, and PR screenshots live on `pr-assets/<pr-number>` side branches that never merge. Older documents still name `docs/verify/<ticket>/...` paths; read those files from history: `git log --diff-filter=D --format=%H -1 -- docs/verify/<ticket>` gives the commit that removed the folder, then `git show <sha>^:docs/verify/<ticket>/<file>` |
| `design/` | Dated design records; see `docs/design/README.md` for the living exceptions | Records. Do not read them as current behaviour |
| `research/` | Research notes archived per ticket (`r*.md`, measurement records) | Archived once written. Cite them as historical material; do not read them as current specs |
