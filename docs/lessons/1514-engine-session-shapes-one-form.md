---
Category: Engine session shapes and model inference covered only one form: Pi tool-result validation failed, the Claude envelope was skipped, and a Claude frame without provider could not yield input.model in multi-model runs
Source: #1514 (2026-10-24)
Level: 2
Safeguard: `trajectory-export.test.ts` exports a Pi toolResult and a Claude assistant envelope through the root command and asserts the full message set; a second billed model is injected, asserting input.model in both the Pi shape (with provider) and the Claude Code shape (only message.model), with the claude-code prefix added per the daemon billing convention
Intercepts: 3
Recurrences: 1
Notes: Negative control: the old parser failed validation on the toolResult's role; the old implementation accepted only one token_usage; on recurrence a Claude frame lacked the provider, the whole-package schema failed and the test went red, passing after the prefix was added. Session shapes come from external engines; the type layer cannot intercept
---

