---
Category: Conversation summaries recognised content blocks but omitted tool names from persisted tool-call records
Source: #1732 (2026-10-25)
Level: 2
Safeguard: `chief-gate-budget.test.ts` exercises both block content and the persisted `kind: toolcall` envelope
Intercepts: 1
Recurrences: 0
Notes: Negative control: the block-only summary omitted the shell tool name; handling the persisted call envelope retains the name and omits arguments and results.
---

