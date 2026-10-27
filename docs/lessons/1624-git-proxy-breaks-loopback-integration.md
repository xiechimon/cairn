---
Category: The local machine's global git config had `http.proxy`; running `vitest run --changed` made a daemon git clone to the loopback server go through the proxy and get 502 in integration, so a batch of full-chain tests failed falsely, and it took a full 20 minutes to find the cause; the rerun then used macOS's missing `timeout` command, exit code 127
Source: #1624 (2026-10-25)
Level: 3
Safeguard: Before running integration locally, first `git config --global --get http.proxy`; if set, run with `NO_PROXY=127.0.0.1,localhost`; long tests watch the log with `tee` per AGENTS.md, without wrapping in `timeout`
Intercepts: 0
Recurrences: 0
Notes: Can be raised to level 1: the daemon already merges loopback `NO_PROXY` for undici (`loopbackNoProxy` in `apps/daemon/src/proxy.ts`) but the git subprocess environment does not, and the user's own machine will hit the same thing; the change is outside #1624's scope and needs its own ticket. Negative control: without `NO_PROXY` the m5-web-e2e main-timeline-spine clone gets 502, passing with it
---

