# Remove "旧版 daemon" wording from the agent machine-fit section

Probe `drive-old-daemon-text.mjs` against a real stack (verify-pacman `launch.mjs`, node22, server :8841): it enrolls `no-snapshot-box` with no capability snapshot, keeps it online by heartbeat, creates an agent, and opens Agent → 权限 → 机器匹配.

| Text | before | after |
|---|---|---|
| Section hint | …从未上报快照的**旧版 daemon** 机器按可跑放行。 | …从未上报快照的机器按可跑放行。 |
| Row hint for `no-snapshot-box` | 能力快照未上报**（旧版 daemon）**——按可跑放行 | 能力快照未上报——按可跑放行 |

Screenshots: `before/`, `after/` (`01-permissions-tab.png`, `02-machine-fit-section.png`); section text in `*/result.json`.
