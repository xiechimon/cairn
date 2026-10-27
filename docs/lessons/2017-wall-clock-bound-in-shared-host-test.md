---
Category: A test on the load-shared host asserted absolute wall-clock milliseconds, so host load rather than the code decided prepush; the attachment-gc event-loop test failed three prepush runs on 2026-10-27 at load 40-44
Source: #2017 (2026-10-27)
Level: 2
Safeguard: The event-loop test asserts event-loop ordering instead of milliseconds: the concurrent HTTP response must settle while the gc sweep is still mid-corpus (no completion log line yet), and a fully synchronous tick goes red (negative control: docs/verify/2017/negative-control.txt)
Intercepts: 0
Recurrences: 0
Notes: The bounds came from #1719, which measured 271 ms against a 100 ms bound on the then-synchronous sweep; the batched version measured 327-334 ms under load 40-44. A grep gate over ms bounds in tests is not feasible without false positives on intentional timeout assertions (github-reads.test.ts, github-gate-transport.test.ts, merge-gate-evidence-link.test.ts still carry such bounds; those files are left to a separate ticket).
---
