# #905 acceptance evidence index — from planning black box to a readable "what is it doing"

Driver = `scripts/evidence-905.mjs`: **the same script, the same viewport (1440x732), the same set of coordinates** drives two stacks — `before/` = a throwaway detached worktree stack of `origin/main` (`/tmp/pacman-before-905`, 8801/5283), `after/` = this branch's stack (8796/5278), each with its own scratch `PACMAN_HOME` (fresh library seed). The method follows `docs/verify/873/`: all bedding goes through public REST + a **fake machine** claims the planning step (zero daemon zero LLM); the fake machine replays activity reports, tool-row returns and text deltas on `POST /api/machine/tool/{stepId}` in the real daemon's wire shape; Playwright `recordVideo` records, ffmpeg crops to the conversation column (`crop=712:692:240:40`, 8fps / 96 colors / 640 wide) and converts to GIF.

| directory | content | result |
|---|---|---|
| `after/` | this branch's code, same script same viewpoint | live-row labels readable phase by phase: `处理中...` → `准备工作区...` → `正在连接模型...` → `模型思考中...` → `正在执行工具：bash` → `模型输出中...`; the disclosure panel's three lines `本步：规划中 / 执行机器：activity-probe / 最近信号：Ns 前`; silence-period freshness honestly grows **6s → 10s → 14s** (the "moving vs stuck" criterion); activity reports **8/8 accepted** |
| `before/` | `origin/main`, same script same viewpoint | all 8 sample points read `处理中...` for the whole run (the user's reported black box as-is); the disclosure panel has only the two lines `本步 / 执行机器`, no freshness; activity reports **8/8 rejected (400)** — the old server has no fourth shape, the script records it faithfully instead of hiding it |

Every number comes from the same run's `result-{before,after}.json` (GIF, screenshots and numbers from one run).

## Symptom ↔ root cause ↔ fix

| symptom (ticket) | root cause (pinned in baseline.md §B) | fix (single source) |
|---|---|---|
| "stuck at processing, a black box" | `thinking_delta` during the thinking phase and the tool-execution half of `toolcall_end` (no result) are discarded in the runner, leaving the UI with no signal at all; planning steps really take a median of 15s with a 137s tail, the whole long window is silent | the daemon derives phases from the **existing** StepEvent (15 vocabulary items, zero changes), reports them via the tool/{stepId} fourth shape; the server stamps `{stepId, at}` transients into the session stream's `activity` event; the live-row label = the phase word (shared #873 `LiveRow` for detail + chief, no new set) |
| "can't tell normal-slow from stuck" | seconds can only prove the row is alive, not that the model is alive | the disclosure face `最近信号：Ns 前` is a ticking display: the daemon reports only when a **real event arrives** (zero retransmits during silence, no timer); the number growing = an honest presentation of being stuck (the #471 law: no real moment, the whole row does not render) |
| "why so long" has no explanation | auto-retry / context compaction only go to the daemon log | `retrying(attempt)` / `compacting` phases go straight upstream as readable labels |

## Existing laws held

- **#471**: the freshness row renders only with a real `at` (server-stamped) and ticks at 1s; fixture / old server / silent window = the whole row absent, never a frozen number. The ticking reuses `useLiveSeconds`.
- **#873**: both faces share one `LiveRow` — this ticket only adds `labelVars` and the shared `LiveSignal` row; the row skeleton / expansion law / ticking law are copied zero times.
- **Vocabulary lock**: `stepEventSchema`'s 15 items stay locked 1:1 with pi (vocabulary.test untouched); activity is an independent wire shape (machine-wire fourth shape + session-stream fifth event).
- **Old↔new interoperability**: old daemon → new server = no activity event, the UI falls back to the existing labels; new daemon → old server = the fourth shape 400s, the daemon fire-and-forgets with a single warning, the step is unaffected (the before stack's 8x400 is exactly the proof).

## Reproduction

```sh
# after (this branch's stack)
VERIFY_PORT=8796 VERIFY_WEB_PORT=5278 node .claude/skills/verify-pacman/scripts/launch.mjs
VERIFY_REPO_ROOT=$PWD EVIDENCE_TAG=after node docs/verify/905/scripts/evidence-905.mjs
# before (a throwaway origin/main worktree stack)
git worktree add --detach /tmp/pacman-before-905 origin/main && (cd /tmp/pacman-before-905 && corepack pnpm install)
VERIFY_REPO_ROOT=/tmp/pacman-before-905 VERIFY_PORT=8801 VERIFY_WEB_PORT=5283 \
  node /tmp/pacman-before-905/.claude/skills/verify-pacman/scripts/launch.mjs
VERIFY_REPO_ROOT=/tmp/pacman-before-905 EVIDENCE_TAG=before node docs/verify/905/scripts/evidence-905.mjs
# GIF (same recipe for both stacks)
ffmpeg -i <tag>.webm -vf "fps=8,crop=712:692:240:40,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse" <tag>.gif
```

Duration/signal baseline data (ticket acceptance item 3) is in `baseline.md`.
