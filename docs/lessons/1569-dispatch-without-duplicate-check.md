---
Category: No duplicate check before dispatch: when dispatching #1569 and #1578 to codex/pi, another Claude session on the same machine was already working the same tickets in /tmp/pm-1569-*, /tmp/pm-1578-*, so #1569 was done twice
Source: #1569/#1578 (2026-10-24)
Level: 2
Safeguard: `scripts/dispatch-agent.mjs start --ticket <N>` checks git working directories under the system tmp directory, origin branches, open PRs, and codex/pi/grok processes; any hit refuses to start and only `--force` proceeds; the pure function `scripts/dispatch-dedupe.mjs` is pinned by `scripts/dispatch-dedupe.test.mjs` (CI dispatch-agent-test job) for numeric boundaries, self-exclusion, and gh-unavailable
Intercepts: 0
Recurrences: 0
Notes: Negative control: running `start --ticket 1569` for 1569 hit /tmp/pm-1569-* (branch obs/1569-langfuse-selfhost) and refused with exit code 1; without `--ticket` it still does not check, relying on the dispatch prompt `docs/agent-dispatch-prompts.md` requiring it
---
