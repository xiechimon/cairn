---
Category: The local global git config had `http.proxy`; when `vitest run --changed` ran integration, the daemon's git clone of the loopback server went through the proxy and got 502, a whole batch of full-chain tests failed falsely, and it took 20 minutes to find; the rerun then used macOS's missing `timeout` command and exited 127
Source: #1624 (2026-10-25)
Level: 3
Safeguard: before running integration locally, run `git config --global --get http.proxy`; if set, pass `NO_PROXY=127.0.0.1,localhost`; per AGENTS.md, watch long runs with `tee` and never wrap them in `timeout`
Intercepts: 0
Recurrences: 0
Notes: can be raised to level 1: the daemon already merges loopback `NO_PROXY` for undici (`loopbackNoProxy` in `apps/daemon/src/proxy.ts`), but git child processes do not get it yet and a user machine hits the same thing; that change is outside #1624's scope and needs its own ticket. Negative control: without `NO_PROXY` the `m5-web-e2e` main-spine clone gets 502, with it the tests pass
---
