# Coordinator memory recall

Status: accepted (owner decision 2026-11-17: add relevance recall on user-turn context assembly). Research: [DS-Bot vs cairn](../research/ds-bot-vs-cairn-2026-11-17.md) recommendation 1; [personal agent memory](../research/personal-agent-memory-2026-11-07.md) (Letta core/archival split; Codex "when to consult memory" boundary). Backend model: [memory-backend.md](memory-backend.md).

## Gap being closed

Injection today is recency- and routing-bound only:

- The team-scope MEMORY.md index is always injected but bounded (200 lines / 25 KiB); facts beyond the bound exist only as a "page through `memories`" reminder, and the model cannot search for what it does not know exists.
- Project memory enters only when the step's `scopeProjectId` is set; a relevant fact in another project never reaches the turn.
- `searchable` memory files are pointer-only in the index; recall depends on the model calling `memories` and on the query's terms appearing literally (substring AND-match in `searchMemoryEntries`).

All three miss silently. This change adds a best-effort recall pass at turn-context assembly, patterned on the existing skill-route hint (`suggestSkillsForMessage` / `formatSkillRouteSection` / `stripSkillRouteSection`): score the user text against memory candidates, inject a short labelled section only when something clears the bar, and let the model ignore or verify it.

## Trigger and query

- Runs inside `chiefTurnContext` only when `trigger === 'user'` — the same gate as the skill-route section. Event, wake, digest and system turns get no recall section.
- Query text is `stripTurnContext(stepRow.prompt)` with the picked-project marker already removed by that stripper. `memories`, `save_memory` tool output and injected sections never feed the query.

## Candidates

Same visibility rules as injection; nothing can surface that injection could not show:

- Owner: `agentId` + `teamId`, `independent = false`, `adoptedFrom IS NULL`, `invalidAt IS NULL` — the same predicates as `ownerWhere`/`stillValid`.
- Fact granularity: valid `core` index documents are expanded to index facts (`listMemoryEntries`), so a single buried line can hit without its whole index.
- Files: `searchable` rows rank as `title` + first content line (the pointer already shown in the index); full file text is not ranked — the model reads it via `memories` after a pointer hit.
- Scopes: team scope plus every listed project (`listedProjects`), so a hit can come from a project the turn is not routed to; each line carries a scope tag. `scratchpad` rows are excluded — they are thread-local and already injected.

## Scoring and selection

- Normalization and terms follow the codebase's existing style (`overlaps`/`searchMemoryEntries`): NFKC fold, lowercase; CJK character bigrams plus latin/number word tokens.
- Score = fraction of distinct query terms present in the candidate text, with title terms counting double over body terms. A candidate must cover at least two distinct query terms and score ≥ 0.15. There is no vector store and no new dependency.
- Selection: top 4 by score, then: drop any candidate whose rendered line already appears in this turn's injected index/project text; drop any fact id already recalled earlier on this thread (per-thread suppress set held in process; a server restart simply allows one harmless re-inject).
- The whole recall section is skipped when nothing survives; the injected budget stays bounded by the entry cap and per-line rendering, well under the existing index bound.

## Rendering

A new labelled section appended to the turn instruction alongside the project and skill-route sections:

```
## 相关记忆（按本轮消息命中，先核对再用）
- [team] 部署机：ssh omarchy 是 ian 的 Linux 桌面（别用 IP/裸主机名）
- [项目 · 个人博客] 发布：Cloudflare Pages，push main 即发，没有服务器
- [项目 · cairn] verify-gotchas.md — 本地别跑 pnpm e2e，受影响面会拉满全量 spec（memories file 读全文）
命中的条目可能已过时或与当前问题无关，不切合直接忽略。
```

The heading constant lives in `packages/shared/src/turn-context.ts` next to the project headings, and `stripTurnContext` cuts it the same way it cuts the other injected sections, so recall text never persists into stored prompts or re-seeding.

## Failure modes and tests to write first

| # | Case | Expected | Test |
|---|---|---|---|
| 1 | Fact beyond the index bound matches the user text | Line appears in the recall section | server `memory-recall.test.ts` "recalls a fact from the truncated tail" |
| 2 | Fact in a different project scope matches | Line appears with the project tag | "recalls a fact from another project scope" |
| 3 | Searchable file matches on title/first line | Pointer line with `memories file` hint appears | "recalls a memory file pointer" |
| 4 | No candidate clears the floor | No recall section in the instruction | "no section when nothing matches" |
| 5 | Candidate already inside the injected index bound | Not duplicated in the recall section | "does not repeat already-injected facts" |
| 6 | Same fact recalled on an earlier turn of the thread | Not repeated | "suppresses facts already recalled on the thread" |
| 7 | Scratchpad, invalidated, superseded, adopted, other-team, independent rows | Never in candidates | "excludes non-injectable rows" |
| 8 | Event/wake/digest turn | No recall section even with a match | "does not run on event turns" |
| 9 | Injected total | Recall section stays inside the entry cap and the turn instruction keeps existing bounds | "bounds the recall section" |
| 10 | Paraphrase with zero term overlap | Miss is accepted (documented limit) | "documents the lexical-miss boundary" |

## What this does not do

- No vector store, embeddings or per-turn extraction call — the design's "curated facts, not transcripts" rule stands.
- No recall on event turns; a wake that needs memory still routes through scope or the `memories` tool.
- Not a recall guarantee: semantic paraphrases with no shared terms still miss. The gain is "index-bounded recency" → "recency ∪ term-level relevance".
- No change to writes, versioning, flush, scope model or the memory UI.
