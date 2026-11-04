---
Category: The split checker accepted a test-injected autonomy pause but its production chief caller supplied no policy input
Source: PR #1654 repair (2026-10-28)
Level: 2
Safeguard: Team autonomyPaused persists through the existing team settings API; createSplitTodo reads database truth and treats a missing team as paused; persona-split-verify.test.ts drives the real chief tool for paused and unpaused teams
Intercepts: 0
Recurrences: 0
Notes: The paused chief-tool regression auto-started on the original implementation. The repaired path keeps both children at todo and records the pause reason, while the unpaused control queues the first child.
---
