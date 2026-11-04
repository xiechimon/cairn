---
Category: The compaction ceiling wrapper treated ordinary errors and quoted summary text as summarization requests, or retained an oversized final block without recovery
Source: #1744 (2026-10-26)
Level: 2
Safeguard: `apps/daemon/test/pi-compaction-ceiling.test.ts` checks non-ceiling errors, quoted markers in user and tool messages, oversized final blocks, and both chat-completions and Anthropic system fields through the actual fetch wrapper
Intercepts: 6
Recurrences: 2
Notes: Negative controls: invalid-key errors were mislabeled, an oversized last block returned 400 after one attempt, a quoted marker truncated ordinary user text, and role-only detection skipped Anthropic summaries. All pass with bounded fallback and system-field identification.
---
