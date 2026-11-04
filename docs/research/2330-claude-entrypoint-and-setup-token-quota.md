# #2330 spike — sdk-cli allowance cost and setup-token rate-limit events

> Inputs to plan decision D50 (multi-account Claude) and implementation issue #2331.
> Measured 2026-10-31 16:22–16:46 UTC on omarchy, Claude Code 2.1.302, signed in with claude.ai OAuth (not a setup-token).
> Absolute account utilization levels, plan tier, reset times and org ids are left out because this repository is public; deltas below are counted from a fresh five-hour window.

## Answers

| Question | Answer |
|---|---|
| Q1: does `claude -p` (entrypoint `sdk-cli`) cost about twice the allowance of interactive mode (`cli`)? | **No, not measurably.** The same task cost the same: 12 runs per percentage point of the `five_hour` window in both modes. A 2x cost would have needed about 24 interactive runs per point. Resolution is about ±1/3 because the window is reported in whole points. |
| Q2: does a setup-token account emit `rate_limit_event` with `utilization` and `resetsAt` for `five_hour` and `seven_day`? | **Not measured; no data exists yet.** The cairn deployed on omarchy (`7de5afe3`, 2026-10-28) predates both the rate-limit storage (#1867) and the setup-token table (#2268), and no step has run with a connected subscription token. See "Q2" for the smallest safe way to get it. |

Side finding that matters for #2331: on an OAuth login the top-level `rateLimitType` / `utilization` in `rate_limit_event` describe only one window (here `seven_day`). The `five_hour` window appears only under `rate_limit_info.unifiedWindows`, which the daemon parser in `apps/daemon/src/backend/claude-code.ts` (`case 'rate_limit_event'`) drops. Per-account quota tracking must read `unifiedWindows`.

## Q1 method

- Same account, same machine, same working directory (`/tmp/spike2330`, empty), same flags in both modes: `--model claude-opus-5-5 --effort low --tools "" --strict-mcp-config`.
- Task: `Output the integers from 1 to 1500 in ascending order, separated by single spaces. Output nothing else.` It is output-heavy and deterministic, so each run costs almost the same.
- One unit = 4 runs started together, so the measured usage is large compared with usage from other sessions on the account.
  - `sdk-cli` unit: 4 parallel `claude -p "$PROMPT" "${FLAGS[@]}" --output-format stream-json --verbose`.
  - `cli` unit: 4 interactive `claude "${FLAGS[@]}"` sessions in tmux panes. Each run sends `/clear`, then the prompt via `tmux send-keys -l`, then Enter. A run is done when its transcript (`~/.claude/projects/-tmp-spike2330/*.jsonl`) records an `end_turn` message with `"entrypoint":"cli"`.
- After every unit the driver reads `Current session: N% used` from `claude -p /usage`. It counts units between consecutive whole-point crossings. Counting from crossing to crossing removes the rounding error at the start of a phase.
- Phase order: `sdk` until the first crossing (alignment), `sdk` for one more point, then `cli` for one point. The run started at 16:40:40Z, right after the five-hour window reset. Total spend was 3 points of that window plus about 1 point on a calibration run in the previous window.
- The transcript `entrypoint` field confirms the modes: `-p` runs record `"entrypoint":"sdk-cli"`, tmux runs record `"entrypoint":"cli"`.

## Q1 raw results

Driver log (`run2.log`). `pct` is from `/usage`. `rl5h` is `unifiedWindows.five_hour.utilization` from the `-p` runs' own `rate_limit_event`.

```
START 2026-10-31T16:40:40Z pct=0
PHASE sdk need=1 2026-10-31T16:40:40Z
UNIT n=1 mode=sdk k=1 t=2026-10-31T16:41:13Z rl5h=0 pct=0
UNIT n=2 mode=sdk k=2 t=2026-10-31T16:41:40Z rl5h=0.01 pct=0
UNIT n=3 mode=sdk k=3 t=2026-10-31T16:42:07Z rl5h=0.01 pct=1
CROSS mode=sdk k=3 from=0 to=1 t=2026-10-31T16:42:07Z
PHASE sdk need=1 2026-10-31T16:42:07Z
UNIT n=4 mode=sdk k=1 t=2026-10-31T16:42:34Z rl5h=0.01 pct=1
UNIT n=5 mode=sdk k=2 t=2026-10-31T16:43:03Z rl5h=0.01 pct=1
UNIT n=6 mode=sdk k=3 t=2026-10-31T16:43:37Z rl5h=0.01 pct=2
CROSS mode=sdk k=3 from=1 to=2 t=2026-10-31T16:43:37Z
PHASE cli need=1 2026-10-31T16:43:37Z
UNIT n=7 mode=cli k=1 t=2026-10-31T16:44:16Z rl5h=- pct=2
UNIT n=8 mode=cli k=2 t=2026-10-31T16:44:52Z rl5h=- pct=2
UNIT n=9 mode=cli k=3 t=2026-10-31T16:45:26Z rl5h=- pct=3
CROSS mode=cli k=3 from=2 to=3 t=2026-10-31T16:45:26Z
DONE 2026-10-31T16:45:26Z
```

Per-run tokens (from the `result` line for `sdk-cli`, from the transcript for `cli`):

| Mode | Runs | Output tokens per run | Cache read | Cache create | Input |
|---|---|---|---|---|---|
| sdk-cli, first unit | 4 | 3516–3525 | 2272 | 1897 | 2 |
| sdk-cli, later units | 20 | 3502–3528 | 4169 | 0 | 2 |
| cli, first unit | 4 | 3502–3516 | 645 | 3725 | 2 |
| cli, later units | 8 | 3502–3516 | 4370 | 0 | 2 |

Every run in both modes returned the full sequence ending in `1499 1500`. The work per run is the same within 1%. The interactive system prompt is about 200 tokens larger, all of it cached.

Reading: 3 units (12 runs) per point in each mode. The alignment phase also took 3 units from the reset. So 24 `sdk-cli` runs cost 2 points and 12 `cli` runs cost 1 point: about 0.083 points per run in both modes. With whole-point readings, each count is uncertain by about one unit. A real 2x `sdk-cli` surcharge would have shown as 6 `cli` units against 3 `sdk-cli` units, and it did not.

Limits:
- Other Claude Code sessions on the same account were active during the run. Their usage adds to both phases at a similar rate because the phases took similar wall time (90 s for the `sdk-cli` point, 109 s for the `cli` point). If anything, this pushes the measured ratio toward 1, but not enough to hide 2x.
- One alternation (A, A, B), not the 3x3 the issue asked for. Each point costs 1% of the five-hour window, and the spike budget was about 2%. Finer runs would spend more allowance without changing the conclusion.
- Only Opus 5.5 with low effort and no tools was tested. Tool-heavy agent turns were not tested; the claim in magpie (`internal/claudetui/tui.go`, citing anthropics/claude-code#97074) is about entrypoint, not workload, so this test targets it directly.
- `/usage` and the `rate_limit_event` field disagree on rounding (before the reset, `/usage` already showed the next whole point while the event still showed the previous hundredth). Use one source consistently.

Calibration before the reset (`run1-calibration.log`): 17 single runs of a 600-number variant moved the window by less than one point, so units were enlarged and parallelized as described above.

## Q2: where cairn records rate-limit notices, and what is there

- Daemon: `apps/daemon/src/backend/claude-code.ts` parses `rate_limit_event` into `{status, rateLimitType, utilization, resetsAt}` from the top level of `rate_limit_info` only. `apps/daemon/src/runner.ts` (`onClaudeRateLimit`) posts it to `POST /api/machine/rate-limit` per machine.
- Server: `apps/server/src/routes-machine.ts` → `recordClaudeRateLimit` in `apps/server/src/services/claude-rate-limit.ts` stores windows in the `machine.claudeRateLimits` JSON column. Setup-tokens live in `claude_subscription`.
- omarchy, read-only (`sqlite3 "file:/mnt/fast/cairn/server/server.db?mode=ro"`): `machine` has no `claudeRateLimits` column and there is no `claude_subscription` table. The server and daemon run from `~/Code/AgentProjects/cairn` at `7de5afe3` (2026-10-28 08:20Z), which is 165 commits behind main and before #1867 and #2268. `~/.cairn/daemon.log` has no Claude rate-limit lines.

What is missing: one stream-json run authenticated only by a setup-token.

Smallest safe way to get it (no stored token read, nothing printed):
1. ian runs `claude setup-token` on omarchy and writes the token to a mode-600 file, e.g. `~/.config/cairn/spike-setup-token`.
2. From an empty directory, with no OAuth login in scope (`CLAUDE_CONFIG_DIR` pointed at an empty temp dir), run once:
   `CLAUDE_CONFIG_DIR=$(mktemp -d) CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/cairn/spike-setup-token)" claude -p "reply with the word ok" --model claude-haiku-5-5 --tools "" --output-format stream-json --verbose | grep '"type":"rate_limit_event"'`
3. Record whether `rate_limit_info.unifiedWindows.five_hour` and `.seven_day` carry `utilization` and `resetsAt`, then delete the file or keep it for #2331.

Using raw stream-json is better than waiting for a deploy: even after #1867 is deployed, `machine.claudeRateLimits` would store only the top-level window, not `unifiedWindows`.

## Raw sample (OAuth login, `-p` run, reset time and absolute levels redacted)

```json
{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":"<redacted>","rateLimitType":"seven_day","utilization":"<redacted>","overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false,"unifiedWindows":{"five_hour":{"utilization":0.01,"resetsAt":"<redacted>"},"seven_day":{"utilization":"<redacted>","resetsAt":"<redacted>"}},"overageEnabled":false}}
```

Driver scripts and full logs are kept outside the repository on omarchy under `/tmp/spike2330/` (`drive.sh`, `drive2.sh`, `run1-calibration.log`, `run2.log`, `logs/`).

## Consequence for D50

- Keep driving Claude Code with `claude -p` stream-json; this spike gives no reason to switch to a pseudo-terminal driver. No follow-up issue is filed.
- #2331 should parse `rate_limit_info.unifiedWindows` (all windows, each with `utilization` and `resetsAt`) instead of only the top-level fields, and run the Q2 check above before relying on it for setup-token accounts.
