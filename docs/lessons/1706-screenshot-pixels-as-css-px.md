---
Category: UI audit measured widths from 2x screenshot pixels and read them as CSS pixels (composer "1600px", settings "1070px"), and claimed tabular-nums was unused without grepping
Source: Claude thread `打磨 Cairn 界面细节` (2026-10-25)
Level: 5
Safeguard: Memory: measure geometry with `getBoundingClientRect` in the page, never from screenshot pixels; grep before saying a utility is unused
Intercepts: 0
Recurrences: 0
Notes: Judgment error in a report, not in code; no machine check can see it
---

