---
"@xiechimon/cairn": patch
"@xiechimon/cairn-cli": patch
---

The Coordinator compacts its resumed pi session while the conversation is idle, inside the provider cache window, so the next message no longer waits on a summary. `GET /api/teams/:id/coordinator/context` reports the working set and `POST /api/teams/:id/coordinator/compact` compacts now. The CLI runs compaction-only Coordinator steps, reports each turn's context size and advertises the `chief-compact` machine feature; the server sends compaction steps only to machines that advertise it.
