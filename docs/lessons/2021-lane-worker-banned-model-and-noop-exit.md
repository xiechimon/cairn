---
Category: Omarchy lane workers returned rc 0 after ~55s on banned deepseek-v4-flash routes or Chinese no-op wrap-ups, so overnight logged exits without a delivered PR
Source: #2021 (2026-10-28)
Level: 2
Safeguard: `scripts/lane-model-policy.mjs` + `scripts/lane-worker-exit-gate.mjs` (wired through `dispatch-agent.mjs wait`); negative controls are the real #2021 log lines in `scripts/lane-worker-exit-gate.test.mjs` and `docs/verify/2021/`
Intercepts: 0
Recurrences: 0
Notes: Higher rung (stopping ai-route from selecting the banned id) lives in `~/.agents` on omarchy and is outside this checkout; the repo gate is the machine check that overnight and dispatch must call. `deepseek-v4.1-flash` stays allowed per `.claude/workflow.md`.
---
