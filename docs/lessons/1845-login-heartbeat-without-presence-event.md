---
Category: Login heartbeats updated stored state without an event for an already-online machine, leaving an open page stale
Source: #1845 (2026-10-27)
Level: 2
Safeguard: Presence tests assert change events, re-login events, and no duplicate event for unchanged heartbeats
Intercepts: 1
Recurrences: 0
Notes: Negative control: the inherited presence path emits no event on an online login transition; see docs/verify/1845/presence-red.log
---
