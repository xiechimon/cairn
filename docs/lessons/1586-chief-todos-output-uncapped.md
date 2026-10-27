---
Category: The chief's task list put all spec full text into a single tool result, blowing up the context
Source: #1586 (2026-10-24)
Level: 2
Safeguard: `chief-todos-cap.test.ts` verifies the 32 KiB UTF-8 serialization budget, full pagination, and get-by-id through the real database and tool execution surface
Intercepts: 1
Recurrences: 0
Notes: Negative control: the old implementation output 32369783 bytes, over 32768; the same case turns green after summary pagination. Dynamic serialization size cannot be constrained by static types alone
---
