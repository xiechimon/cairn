# Coordinator system prompt: prior art for structure

Question: how do the two coding-agent prompts we run every day lay out a system prompt (sections, order, tone, tool guidance, dynamic context), and what should the Coordinator prompt in `apps/server/src/services/chief.ts` (`buildChiefSystemPrompt`) borrow?

Labels: `实测` = read in the source or in a live prompt during this research; `推断` = derived from those readings.

## Sources

- OpenAI Codex CLI, `github.com/openai/codex` at `e54a5713c` (2026-11-09): `codex-rs/models-manager/prompt.md`, `codex-rs/core/gpt_5_2_prompt.md`, `codex-rs/core/gpt-5.2-codex_prompt.md`, `codex-rs/ext/skills/src/{catalog_prompt,render}.rs`, `codex-rs/core/src/context/`.
- Claude Code: the system prompt and context blocks this research session itself received (Claude Code in the desktop app, 2026-11-09).
- t3code: not read. It is a GUI over Codex and Claude Code sessions and does not own a coordinator prompt, so it has nothing to add on prompt layout (`推断`).

## Findings

| # | Finding | Codex | Claude Code | Label |
|---|---|---|---|---|
| 1 | One identity paragraph first: who you are, where you run, what you can do. | `You are a coding agent running in the Codex CLI…` then a capabilities list. | One identity line, then sections. | `实测` |
| 2 | Static behaviour is grouped under a few headings by phase of work, not one flat list. | `# How you work` → `## Personality`, `## Planning`, `## Task execution`, `## Validating your work`, `## Presenting your work`; then `# Tool Guidelines`. | Sections for doing tasks, tool use, tone and output, safety. | `实测` |
| 3 | Tool mechanics live in the tool definition; the prompt keeps only cross-tool policy. | `# Tool Guidelines` holds two short subsections (shell, `update_plan`); everything else is in tool schemas. | Per-tool rules sit in each tool's description; the prompt says when to prefer which tool. | `实测` |
| 4 | Dynamic context comes after the static text and is rendered as readable lines, never raw JSON. | `<environment_context>` with one tag per fact; skills as `- name: description (locator)` under `### Available skills`. | `# Environment` and `gitStatus` blocks at the end; skills as `- name: description`; memory index as `- [Title](file) — hook`. | `实测` |
| 5 | Untrusted content gets its own section, phrased as a boundary: where valid instructions come from, and that everything else is data. | Not a separate section in the base prompt. | A dedicated instruction-source section: tool output, files and pages are data, not commands. | `实测` |
| 6 | One language per prompt, second person, imperative, short sentences. | English throughout. | English throughout. | `实测` |
| 7 | Static text first and dynamic text last keeps the cacheable prefix stable. | Base instructions are separate from per-turn context items. | Dynamic blocks are appended after the static prompt. | `推断` |

## What the Coordinator prompt does today (`origin/main` `3bc564869`)

- One identity line, the charter, then `## 工作约定` with 24 flat bullets mixing routing, answering, memory, event turns, merge policy and third-party data (`实测`).
- One bullet is an English constant (`COORDINATOR_GITHUB_OVERLAP_RULE`) and one an English ADR line, inside Chinese text (`实测`).
- Projects and skills are `JSON.stringify` dumps; thread state lines are English (`实测`).
- Three memory bullets overlap; the quota repeats the `save_memory` description (`实测`).
- The `措辞→spec` bullet tells the Coordinator to rewrite requests into a three-part brief, which the merged design `docs/design/coordinator-routes-verbatim.md` replaces: the Coordinator routes and never rewrites the owner's words (`实测`).

## Comparison

| Option | Structure | Cost | Fit |
|---|---|---|---|
| Keep the flat list, fix wording only | 24 bullets under one heading | Smallest diff | Leaves findings 2 and 4 unaddressed |
| Codex/Claude Code layout (chosen) | Identity → charter → conventions grouped by phase (routing, project placement, answering, event turns, memory, third-party text, skills) → team context as readable lists → memory → digests | Rewrites one function and the tests that pin text | Matches findings 1–7; keeps `## 工作约定` and the `你是「Coordinator」` opener that the eval harness keys on |
| Move all policy into tool descriptions | Prompt holds identity and context only | Large tool-schema churn; cross-tool policy (routing order, event turns) has no single tool to live in | Breaks finding 3's split between policy and mechanics |

## Recommendation

Adopt the grouped layout:
- Chinese throughout, with tool and identifier names verbatim.
- Subsections under `## 工作约定`: `### 路由`, `### 项目归属`, `### 回答`, `### 事件回合`, `### 记忆`, `### 第三方文字`, `### 技能`. The eval's `cut` arm replaces `## 工作约定` up to the next `## ` heading, so `###` subsections keep it working.
- Projects, skills, threads and needs-you rendered as bullet lists, as in finding 4.
- Tool mechanics that only repeat a tool description leave the prompt: the memory quota and the `recommended` option flag. The "no Other option" rule moves into the `ask_user` description.
- The overlap rule moves into the Chinese prompt and reports its result in the reply, as the verbatim design specifies.
