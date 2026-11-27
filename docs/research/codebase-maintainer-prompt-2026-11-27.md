# Codebase Maintainer Prompt for Coding Tasks — Research (2026-11-27)

## Primary Source

- **Source**: Anthropic official prompting documentation — *Prompting Claude Fable 5.2*, section `#say-who-owns-the-code` ([platform.claude.com](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2#say-who-owns-the-code)) — `实测` (fetched first-hand on 2026-11-27).
- **Exact prompt sentence documented by Anthropic**:
  > `You are the owner and long-term maintainer of this codebase, and its design is up to you.`
- **Measured effects reported by Anthropic** (on small coding tasks):
  - **Duplicate consolidation**: Claude consolidated duplicated code into one shared function in **under 10 percent** of runs without the sentence vs **about 75 percent** of runs with it (`实测`).
  - **Token cost & overreach**: Output tokens rose by **about 70 to 80 percent**, and the model made unasked-for changes (many new tests and documentation) and in some runs changed how an existing feature behaves; closing PR summaries often omitted small changes (`实测`).
  - **Scope-limiting caveat**: Anthropic explicitly warns: *"Leave the ownership sentence out where the user owns the code and wants it changed as little as possible. A rule that limits scope doesn't cancel it. In Anthropic's testing, the model still consolidated duplicated code in more than half of runs when 'No drive-by refactors, renames or cleanups' appeared earlier in the same prompt."* (`实测`).
  - **Preserved-thinking prefix note**: Changing `system`, `tools`, or earlier messages in a resumed conversation can fail the Anthropic prefix check (`400`); Cairn's `pi` backend already handles thinking-signature recovery (`apps/daemon/test/pi-thinking-binding.test.ts`), and `antigravity` sends `_meta.antigravity.systemPrompt.append` on new sessions only (`实测`).

## Placement Comparison in Cairn

| Option | How it works | Trade-offs | Link |
|---|---|---|---|
| 1. Anthropic verbatim wording | Inject `"You are the owner and long-term maintainer of this codebase, and its design is up to you."` | Unsuitable for a multi-user product: the user owns the repository and design authority, not the agent (`推断`) | [Anthropic doc](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2#say-who-owns-the-code) |
| 2. Server `SESSION_BRIEF` only | Put maintainer framing into `SESSION_BRIEF` in `packages/shared/src/records/prompts.ts` | Misses `plan` and `build` steps; places framing in the user turn instead of the system prompt (`实测`) | [prompts.ts](../../packages/shared/src/records/prompts.ts) |
| 3. **Chosen: single daemon builder + shared constant** | Define `CODEBASE_MAINTAINER_GUIDANCE` in `packages/shared/src/records/prompts.ts`, inject in `composeWorkerSystemPrompt` (`apps/daemon/src/step-prompt.ts`) via `isCodingTaskStep(claimed)` in `apps/daemon/src/runner.ts`, and reconcile `SESSION_BRIEF` line 3 | Single builder serves `claude-code`, `pi`, `devin`, `antigravity` (and `gemini`) with zero per-runtime copies; excludes `review`, `verify`, `merge`, `chief`, and `info` tasks; preserves `LEGACY_SESSION_BRIEFS` for origin backfill (`实测`) | [step-prompt.ts](../../apps/daemon/src/step-prompt.ts), [runner.ts](../../apps/daemon/src/runner.ts) |

## Concrete Recommendation

1. Keep ownership with the user and phrase the framing as long-term maintenance responsibility plus explicit guardrails against silently altering unrelated working behavior.
2. Inject `CODEBASE_MAINTAINER_GUIDANCE` once in `composeWorkerSystemPrompt` (not `composeStepSessionOpts`, which `composeSessionBrief` overwrites in `apps/daemon/src/runner.ts`) when `isCodingTaskStep(claimed)` is true (`plan`, `build`, `session` on non-info tasks).
3. Update `SESSION_BRIEF` step 3 (`"make the smallest change"` -> `"implement the change cleanly"`) while preserving the prior string in `LEGACY_SESSION_BRIEFS` so `apps/server/src/services/transcript-origin-backfill.ts` continues marking legacy rows as `synthetic`.
