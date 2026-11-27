# Codebase Maintainer Prompt for Coding Tasks — plan, 2026-11-27

## User scenario

A first-time Cairn user starts any coding task (`todo.output` is `'code'` or omitted, on `plan`/`build`/`session` steps) across `claude-code`, `pi`, `devin`, `antigravity`, or `gemini`. No new settings, keys, accounts, or storage are needed: the daemon delivers `CODEBASE_MAINTAINER_GUIDANCE` through its single worker prompt builder so the agent consolidates duplicate logic, deletes replaced dead paths, and moves all callers while preserving unrelated working behavior (and naming any incidental change in its summary). Expect higher output token usage and task latency (~70–80% extra output tokens in Anthropic's benchmark); prompt delivery is deterministic, while model adherence is measured in benchmarks rather than guaranteed. On failure (missing resumable session, legacy brief marker, crash without journal prompt), existing error/fallback paths surface the failure or open a fresh session with the new guidance.

Prior art ([docs/research/codebase-maintainer-prompt-2026-11-27.md](../research/codebase-maintainer-prompt-2026-11-27.md)): Anthropic's *Prompting Claude Fable 5.2* (`https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2#say-who-owns-the-code`) reports `"You are the owner and long-term maintainer of this codebase, and its design is up to you."` raised duplicate consolidation from `<10%` to `~75%`, with `+70–80%` output tokens and unasked-for behavior edits. Because Cairn users own their repos, Cairn omits ownership/design authority and respects explicit minimal-change limits.

## Scope

1. Define `CODEBASE_MAINTAINER_GUIDANCE` in `packages/shared/src/records/prompts.ts` (never claiming repo ownership or design authority, and yielding to explicit minimal-change requests): `'You maintain this codebase long-term. Unless the user asks for a minimal change, consolidate duplicate logic your change touches or meets nearby into one shared path, remove dead paths your change replaces, and move every caller in the same change. Working behavior outside the task stays unchanged; do not alter it unless required by the task, and name any unavoidable change with its reason in your summary.'`
2. Inject `CODEBASE_MAINTAINER_GUIDANCE` in Cairn's single daemon builder `composeWorkerSystemPrompt` (`apps/daemon/src/step-prompt.ts`) when `opts.codingTask === true`, wired once in `apps/daemon/src/runner.ts` via `isCodingTaskStep(claimed)` (`claimed.todo !== undefined && (kind === 'plan' || isBuildStepKind(kind)) && (claimed.todo.output === undefined || claimed.todo.output === 'code')`), reaching `claude-code`, `pi`, `devin`, `antigravity`, and `gemini` with zero per-runtime copies.
3. Update `SESSION_BRIEF` step 3 in `packages/shared/src/records/prompts.ts` from `"make the smallest change that passes the tests"` to `"implement the change cleanly to pass the tests"`, and keep the exact prior string in `LEGACY_SESSION_BRIEFS`.
4. Persisted state & readers/writers: `startBuilds` (`apps/server/src/services/build-start.ts`) and `restartFailedBuild` (`apps/server/src/services/build-restart.ts`) write `SESSION_BRIEF` into `step.prompt`; `backfillTranscriptOrigins` (`apps/server/src/services/transcript-origin-backfill.ts`) reads `user` rows with `origin IS NULL` (never re-reading stamped rows) and stamps `[SESSION_BRIEF, ...LEGACY_SESSION_BRIEFS]` (exact or with `\n\n<suffix>`) as `'synthetic'`; `mapTranscript` (`apps/web/src/api/mappers.ts`) hides `'synthetic'`/`'task-prompt'` rows and `transcriptPromptRowId(stepId)` rows. Already-migrated DBs (`apps/server/src/index.ts:199`) stay untouched because existing rows are already stamped and new steps carry `transcriptPromptRowId`.
5. Unchanged: `chief`, `review`, `verify`, `merge`, `todo === undefined`, and `info`/`report`/`dataset`/`link` tasks omit `CODEBASE_MAINTAINER_GUIDANCE`; no UI, env var, schema, or wire fields change.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Coding task (`plan`/`build`/`session`, `output` `'code'` or omitted) on `claude-code`, `pi`, `devin`, `antigravity`, `gemini` | Runtime receives `CODEBASE_MAINTAINER_GUIDANCE` (no ownership/design claim, yields to minimal-change request) | `apps/daemon/test/codebase-maintainer-prompt.test.ts` | this change |
| Non-coding steps (`review`, `verify`, `merge`, `chief`), missing `todo`, or `info`/`report`/`dataset`/`link` tasks | Paired with positive case: `CODEBASE_MAINTAINER_GUIDANCE` is omitted; read-only/research prompts stay unchanged | `apps/daemon/test/codebase-maintainer-prompt.test.ts` | this change |
| Empty agent description and no memories (`description: null`, `memories: undefined`) on a coding task | System prompt still carries `CODEBASE_MAINTAINER_GUIDANCE` cleanly without blank gaps | `apps/daemon/test/codebase-maintainer-prompt.test.ts` | this change |
| Antigravity continuation vs fresh-session fallback (`continueSession` vs `SessionNotResumableError`) | Successful `continueSession` omits `_meta.antigravity.systemPrompt` (existing session keeps prior prompt); missing session falls back to `createSession`, emits `resume-miss` note, and delivers new guidance | `apps/daemon/test/codebase-maintainer-prompt.test.ts` | this change |
| Session failure paths (Pi prefix-mismatch recovery vs persistent 400; `resume.prompt === null` crash recovery; legacy brief marker in cwd) | Pi prefix 400 recovers cleanly on retry; `resume.prompt === null` or legacy brief marker fails step with explicit error before opening session | `apps/daemon/test/codebase-maintainer-prompt.test.ts` | this change |
| Transcript origin backfill on unmigrated vs migrated DBs for literal legacy and updated `SESSION_BRIEF` (standalone & `\n\n<restart>`) | Unmigrated `origin IS NULL` rows for both legacy and new literals become `'synthetic'` (`mapTranscript` hides them); already-stamped `'user'` rows stay untouched | `apps/server/test/session-brief-maintainer.test.ts` | this change |

## Out of scope

- Per-project or per-user toggle UI or `CAIRN_*` environment variable for maintainer framing.
- Modifying Coordinator (`chief`), `review`, `verify`, `merge`, or `info`-card prompts.
- Refactoring `WEB_RESEARCH_GUIDANCE` delivery in `composeStepSessionOpts`.

## Review

- Verdict: PASS
- Plan-SHA256: b4ecd9750ecbe187e976bc8c0a8947a2a22cb92ea92c5ef6631ea2c03d0b64b6
- Author-Model: google/gemini-4-neon
- Reviewer: pi-review (openai-codex/gpt-6.2-sol)
- Reviewer-Model: openai-codex/gpt-6.2-sol
- Findings: 4 plan-review findings resolved + head-review wording tightening re-stamped (scope narrowed to duplicate logic touched or met nearby; unrelated behavior changes disallowed unless task-required; Pi prefix recovery + persistent 400 + literal backfill regression tests added and verified RED on parent)
