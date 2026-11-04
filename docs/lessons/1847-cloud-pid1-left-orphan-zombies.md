---
Category: A cloud container's PID 1 did not reap an orphaned esbuild zombie, so live-server cleanup still saw its process group after SIGKILL
Source: #1847 affected verification (2026-10-27)
Level: 2
Safeguard: Run cloud verification and normal push hooks under a command-local Linux subreaper that adopts and waitpid-reaps only its descendants; the unchanged live-server-reap cases verify disposal and caller death
Intercepts: 1
Recurrences: 0
Notes: Negative control on the #1847 lane: 22 browser assertions passed but disposal failed, with only a PPID-1 esbuild zombie remaining in the process group. The same three affected specs pass all 23 assertions under PR_SET_CHILD_SUBREAPER. Product cleanup, assertions and timeouts are unchanged
---
