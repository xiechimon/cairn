---
Category: A second TranscriptBuffer wrote an unreadable-image steer notice to the same file, then the runner's cached buffer overwrote it during its final flush
Source: #1671 (2026-10-27)
Level: 2
Safeguard: The real runMachine upload assertions on the #1671 lane require the final transcript to retain the notice, with and without an image in the initial request; runStep shares one step-local buffer with machine-loop and releases it in finally
Intercepts: 2
Recurrences: 0
Notes: Negative controls in the #1671 evidence steer-buffer-before.txt fail both final-upload assertions; after sharing the buffer, acp-after.txt records five suites and 93 passing cases. The generic journal semantics are unchanged; implementation and acceptance belong to the #1671 lane
---
