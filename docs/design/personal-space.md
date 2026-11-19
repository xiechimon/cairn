# Personal space: a default place for files that belong to no project

Status: approved on 2026-11-16, not built yet. The owner chose to build it and decided four things: there is no separate entry (`不用，该放哪里就放哪里就行了`), and space files show by kind in the existing Results panel groups; a task writes notes, the Coordinator gets no write tool; when the team has no project, a personal request goes to the space without a question. The owner approved implementation on 2026-11-16. Its companion design `quick-lane.md` was revoked on 2026-11-19.

## Problem

A request like "note this down" or "write me a weekly report template" has no destination unless a project exists. A newcomer with no project can only get a read-only research report. Writing such files into a code project would open a PR per note; writing them on a runner's disk would tie them to one machine.

## Decision

1. Each user has one personal space per team: a Cairn-hosted git repository the user never sees as git. A task thread writes it; landing fast-forwards its default branch with no PR. Every landing is one commit, so history and restore come from git.
2. The space is kept apart from three things it could be confused with:

   | Thing | In Cairn | Boundary |
   |---|---|---|
   | Instructions (Home Repo style) | team and project memory, team skills, a project's `AGENTS.md` | Space content is never injected into a prompt or used as a skill source. Landing refuses `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.agents/`, `.cursor/`, `.github/` and git hooks; rules go to memory |
   | Temporary execution sandbox | a task's workspace clone or orb | the clone is a disposable copy; the content lives in the server's repository |
   | The user's own folders | `local` projects, `localPath` on a runner | the space lives in the server data dir (`repos/`), on no runner |
3. Shape: a hidden project row per space, `id = space-<teamId>-<userId>`, `repoKind = 'hosted'`, new nullable column `personalOwnerId`. It is created on first use, as `ensureResearchProject` creates the research project. It is left out of the sidebar, project lists, the Coordinator's project list and research routing.
4. Landing: a new `direct` landing mode, allowed only for space projects. It reuses `applyMergeLanding` (fast-forward against a pinned base, refused when the base moved) and skips the PR and review steps.
5. Restore is a server operation that writes the old content as a new commit; no runner or model is involved, so it is not Coordinator work.
6. Limits: 10 MiB per file (the attachment limit); total size counts toward the team quota.
7. Routing in the Coordinator prompt: a personal request (`记一下`, `存到我的空间`) goes to the space; with no project in the team, any personal request goes there without a question; with projects and an unclear destination, the question lists the space as one option.

## State

| Field | Written by | Read by |
|---|---|---|
| `project.personalOwnerId` (migration) | first-use creation | every check below, list filters |
| space repo `refs/heads/main` | `direct` landing, restore | history, preview, Results panel |
| `todo.request` | request service, unchanged | authorization checks |
| result index entry per space file | `direct` landing, restore, archive | Results panel and search |

## Paths that read or write a space

| # | Path | Check | Writes | On failure |
|---|---|---|---|---|
| P1 | Coordinator `create_todo` with a space `projectId` | owner turn (every cited message is in `step.ownerMessageIds`); `personalOwnerId` equals the author of the cited owner segments | task | `400`, nothing written |
| P2 | Claim | as P1; the clone URL is valid only for this build | step | not dispatched; task in needs-you |
| P3 | `direct` landing | owner segments still valid; regular files only; no symlink, submodule or instruction path; size limit; base not moved | default branch, one commit, result index | refused; the report names each refused file and why |
| P4 | `/git/*` (`routes-git-hosting.ts`) | a space repo answers only the step git key of a claimed step whose task is in that space; the repo sets `receive.hideRefs=refs/heads/main`, so a push cannot move the default branch | none | `401` without credentials (git's challenge, as for any hosted repo), then `404` for any other key; a push to `main` is rejected by git. The wider problem for ordinary hosted repos is #5161 |
| P5 | Coordinator `space_files`, `space_read` (read-only tools) | the thread's owner owns the space | none | `404`; returned content is marked data |
| P6 | Restore (web or Coordinator request) | session user owns the space | new commit, result index | `409` when the base moved; the owner retries |
| P7 | Results panel list and search | session user owns the space | none | other members never see the files |
| P8 | Archive a space file in Results | owner | index state only; history kept | unchanged archive rules |
| P9 | Memory injection, skill loading | none | none | space content never read (static test) |
| P10 | Backup (`scripts/ops/backup-server-db.sh --repos`) | none | bundle per repo | covered by #5160 |
| P11 | Project archive and delete flows | spaces are excluded | none | a space cannot be archived or deleted through project routes |

Privacy in v1: other members cannot see a space in the UI or API, but the runner executing a space task holds a temporary clone. On a shared runner its operator can read that workspace. A single-user install has no such gap.

## Interaction

No new entry point. A space task is one reference row in the conversation like any task; its finished report carries one file line (file icon and path in link ink, the style of the research report line, DESIGN-RULES C11) that opens the file preview panel. In the Results panel, space files sit in the existing groups by kind (text and Markdown under `文档`), sorted by time with reports; a card's meta line reads `我的空间` where a project name would be. The file preview panel gains a `历史` icon button left of copy, only for space files, and a line `在我的空间里，只有你能看到。` above the text. Each older version has a `恢复这个版本` text link; restoring shows a toast with `撤销`. A space task's progress row reads `改文件 → 存好`.

## Failure behavior

- No machine online: the task queues with the composer-line reason (C8).
- Two tasks change one file: the later landing finds the base moved, reruns once, then goes to needs-you; the other version stays in history.
- Instruction file or symlink: refused with `个人空间不放会被 Agent 当成指令的文件（AGENTS.md）。规则请让我存进记忆。`
- Over the size limit: refused with `这个文件超过 10 MB，空间里放不下。`
- A member leaves: the space stays until the team deletes it; no transfer in v1.

## Tests

One per row P1 to P11, including: a user A channel creating into B's space returns `400`; a key not running a space task gets `404` on the space repo; landing `AGENTS.md`, `.claude/settings.json`, a symlink and an 11 MiB file is refused; three edits give three versions, restoring version 1 adds a fourth byte-identical to version 1 and undo adds a fifth identical to version 3; memory injection never reads a space.

## Acceptance

- With no project, `帮我写一份周报模板` gets zero questions and the file appears under `文档` with `我的空间`.
- A person who has not read the repository installs Cairn on a fresh `CAIRN_HOME` and, following only the screen, reaches that result and then a code change on a hosted project. Record stalls (target 0), Coordinator questions (target at most 1) and trips to a terminal.

## PR order

1. S1: `personalOwnerId` migration, first-use creation, list filters, P4.
2. S2: `direct` landing, P3, P6, history (security surface: `machine-merge-landing.ts`).
3. S3: Coordinator routing rules, P5, P9, and no project instructions in a space task's prompt. Before S3 lets any path create a space task, task and build reads (search, `todos`, `threads`, MCP `todos` and `search_threads`, `/api/todos`, `/api/builds/:id/*`) must hide space tasks from everyone but the owner; S1 refuses every creation path and every project move into a space, so nothing reaches them yet.
4. S4: Results panel grouping, search and archive (P7, P8), preview history and restore.
5. E: the newcomer walk-through and its e2e.
