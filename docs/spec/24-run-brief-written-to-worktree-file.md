# 24 · Run brief written to a worktree file (supersedes 17·A9)

> Scope: move each step's agent brief from the systemPrompt channel into a context file in the task worktree, loaded through the CLI's native memory mechanism. It answers three questions: why A9 rejected this back then, and whether those two reasons still hold today; how far to follow Multica; and which new failure surfaces appear after the switch, with the guardrail for each.
>
> References: spec 17 (origin of A9, marked superseded here), spec 14 (skills execution surface; directory scan rules unchanged), Multica source (`execenv/runtime_config.go`, `runtime_config_sections.go`, `repocache/cache.go`, `local_worktree.go`), issues #958 and #917.

## Problem Statement

`docs/spec/17-dual-runtime-execution-surface.md:58` **A9** settled two things: the brief (skills catalog) is appended to systemPrompt; Multica's workdir CLAUDE.md write-in approach is **not adopted**, on the grounds that "it pollutes the worktree git status, which pacman worktree discipline does not allow". The same passage deferred "native `.claude/skills` discovery" to a later ticket.

Both of A9's premises fail today:

1. **"Writing a file is required for the engine to see it" is not a new capability, it is existing behavior.** pi's `resource-loader.js:33` candidate list `["AGENTS.override.md","AGENTS.md","AGENTS.MD","CLAUDE.md","CLAUDE.MD"]` is same-directory first-wins, and `loadProjectContextFiles` walks up level by level from cwd; `systemPromptOverride` **only replaces the customPrompt segment** and does not suppress this loading (`resource-loader.js:383`). claude-code SDK's `settingSources` defaults to "load everything" (`sdk.d.ts:2141-2151`, where `'project'` is the load-bearing tier for CLAUDE.md). In other words, **the CLAUDE.md that ships in the user's repo is already being read today**; pacman simply never writes its own copy.
2. **Git cleanliness has a solution.** Multica cannot use `.git/info/exclude` under a linked worktree — git resolves `info/exclude` against the common dir (`man gitrepository-layout`: `$GIT_COMMON_DIR/info` takes precedence), and in its `local_directory` mode the common dir is the **user's** repo (`local_worktree.go:484-492` admits this in its own words), hence its "erase before commit" fallback. pacman's common dir is `<workspacesRoot>/<projectId>/repo/.git` — **pacman's own mirror clone**, unrelated to the user's repo.

Another cost A9 never counted: while the brief stays in systemPrompt, **it is recomputed every round** (`composeChiefSystemPrompt` is called by `buildChiefClaim` on every claim), and its `machines` roster includes the `online` field that flips with presence heartbeats. Multica filed a separate case over this exact pit (MUL-5377: per-run values written into the brief file "broke prompt-cache prefix stability on every resume"; since fixed by moving them to the per-round user message).

## Solution

| ID | Decision | Landing form |
|---|---|---|
| **B1** | The brief lands in a workspace context file; the systemPrompt channel is emptied for such backends | `AgentBackend.brief?: BriefChannel` (an optional capability bit). Present = write to disk + empty; absent = keep the inline systemPrompt (an escape hatch for a future third backend; Multica's prompt-only mode follows the same rule) |
| **B2** | The landing spot follows the engine's **own discovery order**, not a filename hard-coded by backend name | `resolveBriefTarget(entries, backendId, {caseInsensitiveFs})` (packages/shared/brief-file.ts). Case sensitivity is a **parameter**: `existsSync('CLAUDE.md')` is true on darwin and false on linux when the on-disk name is `CLAUDE.MD`; the ruling and the write must share one source |
| **B3** | Marker-block three-state write + byte-exact erase | `<!-- BEGIN PACMAN-RUNTIME (auto-managed; do not edit) -->` / `<!-- END PACMAN-RUNTIME -->`; the hosting separators `\n\n` **count as part of the managed region**, so the erase rolls back byte for byte (whether the user file ends with 0/1/2 newlines or CRLF), and it doubles as the discriminator for "we created this file" vs "appended into a user file" |
| **B4** | The erase covers **every post-write exit**; an erase failure blocks the commit | Three explicit call sites (openSession throws / stream throws / once after the loop) + write failure fails closed; an erase failure sets a flag → `commitAll`/`push` are both skipped, the step finishes failed, and a system line lands in the transcript |
| **B5** | Defense in depth: `commitAll` recognizes **the marker content** and evicts the file | `git grep --cached -l -F <marker>` scans only the five candidate names; a hit means `git reset --` that path + a workspace log entry |
| **B6** | Reconciliation scans the **union of all backend candidates**; the landing-spot ruling only recognizes the current backend | The same worktree gets reused by steps of different backends; an `AGENTS.md` left by a pi step, if not cleaned in a claude-code step, survives into that step's `git add -A` |
| **B7** | Content split: per-run values stay out of systemPrompt | Already landed with `#959`: the `machines` roster (including `online`) moved out of the chief prompt; the skill-routing section generated per message moved from systemPrompt to the per-round instruction. Regression pin: routing hit and routing miss must produce a **byte-identical** systemPrompt |

### Five hard gates (missing any one, do not ship)

1. **Erase coverage**: `commitAll` is a bare `git add -A` (`workspace.ts:116` → `git.ts:199`, no pathspec). **Pollution is delayed** — a failing step skips its own commit, the file stays in the worktree, and the next step reusing that worktree (typically a merge round, which goes through continue and does **not** trigger the rework rollback) commits and pushes it along. Three concrete leaks: `openSession` throws, the event stream throws, stopped-without-discard; SIGKILL cannot be covered in-process, and is caught by B6's reconciliation plus the `new`-action rollback.
2. **Landing-spot ruling**: pi is same-directory first-wins; writing the wrong file means the brief is **never read at all** (after the full move there is no fallback channel = a silently zero-instruction step), or it **shadows the user's own CLAUDE.md**. A write failure is a `failStep`, never a degradation to "run without a brief".
3. **Cache prefix**: see B7.
4. **The agent touches the carrier file mid-run**: markers intact → normal splice (edits outside the block preserved byte for byte); **markers damaged → do not rewrite the file**; instead exclude it from the commit + `git checkout` back to HEAD + name the sacrificed edits in the transcript. The step still lands; the loss is bounded and visible (the alternative is failing the whole step, but that would make document-class tasks routinely crash).
5. **Channel drift**: once the brief rides the native discovery channel, **any option that touches native discovery becomes a survival dependency of the brief** — if claude-code's `settingSources` is set to `[]` or omits `'project'`, or pi gains `noContextFiles` / `agentsFilesOverride`, the brief **disappears without any error**. Hence #917's point 3 (explicitly declaring `settingSources`) is a **precondition** of this change, not an option.

### Timing of write and erase

The write lands in `runner.ts` after the rework rollback and before the heartbeat, and is hoisted outside the pass loop of the compat fallback (the second pass sees the same on-disk file). The erase runs after the main exit (timers cleared, terminal-state errors already merged), before the `stopped` branch and the two rewinds, and before `commitAll` — isomorphic to Multica's LIFO "cleanup precedes Finalize's add -A".

## Adopt/reject list versus Multica

**Adopted:**

| Mechanism | Multica evidence | Why adopted |
|---|---|---|
| Marker-block three-state write | `runtime_config.go:247-275` | Preserves the user's existing content + idempotent replacement + leaves a precise excision point for the erase. Its predecessor (unconditional `os.WriteFile`) **truncated a user's CLAUDE.md** (MUL-2753); the three-state design is the product of that incident |
| Erase precedes commit; erase failure aborts the commit | `daemon.go:8321-8361` | "Don't commit if you can't erase clean" is more recoverable than "committed a polluted tree" |
| Per-run values stay out of the brief file | `runtime_config_sections.go:1059-1063` (MUL-5377) | The brief file's entire value is its "byte-stable cache prefix"; mixing in a value that changes per message zeroes that value out |
| Landing spot split per provider | `runtime_config.go:197-223` | Adopt its **shape** (different filenames per engine), not its **quantity** (an enumeration table of 25 providers — pacman has only two backends, and both sit in `@pacman/shared`'s candidate list) |

**Rejected:**

| Mechanism | Why rejected |
|---|---|
| Hiding via `.git/info/exclude` | Multica writes a per-worktree gitdir, and **git never reads that file** (a linked worktree resolves to the common dir) — the copy at `repocache/cache.go:2183` is dead code, and its regression test only asserts file contents, never that git honors it. Even writing to its own common dir should not be adopted on pacman's side: excluding **by filename** would silently swallow a legitimate `CLAUDE.md` produced by the agent out of `git add -A` (invisible lost work), and it does nothing against the tracked-state modification of "appended into the user's already-tracked CLAUDE.md". See B5's by-content alternative |
| Lists like `providerNeedsInlineSystemPrompt` | It enumerates four runtimes where "the CLI does not read context files" (openclaw/kimi/traecli/qwenpaw). Both pacman backends read natively, so the list is empty — keep the capability bit `brief?` as the escape hatch, without pre-enumerating |
| The cloud scratch-workdir branch exempt from erasure | pacman's worktree is itself the handoff artifact (the branch gets pushed and merged); there is no "GC the whole directory" equivalent |

## Known residuals (registered as they are, no pretending to cover)

- **The agent runs `git add -A && git commit` itself in bash**, writing the marker block into history: **prevention is impossible** — the marker enters the commit before any daemon gate can act; B5's commit gate only governs the daemon's own commit. Detection is wired: after push, `git grep` the five candidate names on the conv branch for the marker; a hit lands a `[step]` log + a transcript system line naming the file and branch (**this is detection, not blocking**; a branch failure does not interrupt the finish). A marker that actually entered branch history **can only be handled by a human before merge**; this layer only guarantees it is visible.
- **A journal-recovered step** rewrites the brief with a **stale claim snapshot** (`machine-loop.ts:277-283`): acceptable, but the recovered round's brief content does not equal the current team state.
- **Catalog scanning changes from "once per pass" to "once per step"**: the compat fallback's second pass no longer rescans (the `pi.ts` semantic of "scan once per session creation" changed).
- **The brief file is visible to `git status` while the step runs** (untracked, not ignored): the unavoidable cost of choosing "erase" over "exclude"; Multica is the same.
- **pi itself injects an `<available_skills>` section** (the resource loader's skills config surface), coexisting with pacman's copy. This volume does **not** eliminate it — that is #917's closing scope, belonging to the old problem of duplicate rosters + an authorization surface that can only gate one copy.

## Relationship with #917

Of #917's four points (skill visibility surface folded back to pacman), **two are landing preconditions of this change**: point 3 (explicitly declare `settingSources: ['user','project','local']` — `'project'` is the load-bearing tier for the brief) and point 4 (the whitelist moves from prompt-level to a hard block). The other two are **voided** by this volume: point 1 (pacman directory injection as the sole source) and point 2 (turn off Claude Code's native Skill surface) — this change depends precisely on the native context-file channel.
