---
Category: No duplicate check before dispatching: #1569 and #1578 were sent to codex/pi while another Claude session on the same machine was already working the same tickets in /tmp/pm-1569-* and /tmp/pm-1578-*; #1569's work was thrown away
Source: #1569/#1578 (2026-10-24)
Level: 2
Safeguard: `scripts/dispatch-agent.mjs start --ticket <N>` checks git work directories under the system tmp dir, origin branches, open PRs and codex/pi/grok processes, and refuses to start on a hit unless `--force`; the pure function `scripts/dispatch-dedupe.mjs` is pinned by `scripts/dispatch-dedupe.test.mjs` (CI dispatch-agent-test job) for numeric boundaries, self-exclusion and gh unavailability
Intercepts: 0
Recurrences: 0
Notes: negative control: `start --ticket 1569` for 1569 matched /tmp/pm-1569-* (branch obs/1569-langfuse-selfhost) and refused with exit code 1; without `--ticket` it still does not check, which the dispatch prompt in `docs/agent-dispatch-prompts.md` covers by requiring the flag
---
