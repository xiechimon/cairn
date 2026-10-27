# Cairn workflow (for any Claude or agent taking over)

> Purpose: after switching accounts or machines, a new Claude (Desktop / Code) clones this repo, reads this page and `AGENTS.md`, and continues the same way. This file covers working style, division of labor and a progress summary only; `AGENTS.md` holds the rule details and wins on conflict.
> This repo is public: no secrets, internal addresses, personal information or quota details.

## 1. Project goal

Let cairn iterate on itself: close the spec 28 bootstrap loop (ADR 0021), where cairn picks up tickets, implements, reviews and merges its own PRs; then keep improving the harness (prompts, skills, routing) with an eval and trajectory data loop. No model fine-tuning: "training" here means improving the harness, not changing weights. Routine work goes to cheap executors to save Claude tokens.

## 2. Working style

- Reply to the user in plain Chinese with little jargon. Everything committed to the repo is English (`AGENTS.md`, "Language").
- Fix same-kind bugs or leftovers found during a fix directly, and merge once CI is green without asking.
- Leave no manual steps for the human (such as removing a label on GitHub). Do not put `needs-decision` on a PR: ask in chat when a decision is needed, then merge yourself.
- Ask the human before design trade-offs (changing intended behavior, touching an ADR or a protected path).
- After opening a PR, enable GitHub auto-merge and stop; do not sit watching CI.
- Run a retro before closing every thread (see `.claude/skills/retro-cairn/SKILL.md`) without being reminded. The lessons ledger is `docs/lessons/` (one file per entry).
- One local thread per topic: a new topic gets a new thread instead of piling onto the existing "dispatch local agents" thread; finish existing items in their own thread.
- Threads default to a Sonnet-class model to save tokens; splitting tickets, reviewing changes, writing PRs and making trade-offs is Claude's work.
- Do not stop to wait for the human to set priorities when dispatching; pick the order and go. Attach images directly in the reply, not only in the file library.

## 3. Division of labor (saving tokens)

| Executor | Use for |
|---|---|
| pi | Default executor, unmetered: implementation, tests, lint, e2e, bulk edits, review |
| codex | Small quota, hard jobs only |
| grok | Pace by this week's remaining quota; prefer web and X search |
| Claude | Only split tickets, review changes, write PRs and make trade-offs; avoid reading large code or writing code itself |

These executors all run on the local machine, which cloud threads cannot reach, so work must be dispatched through a thread running locally. Work in a separate directory made with `git clone --local`, not in the main working tree.

Dispatch always with `ai-route run <implement|test|bulk|review|scout|summary> [-C <dir>] [--hard] "<task>"`: each run measures which models work and reads remaining quota before choosing the executor and model. Do not hand-write pi / codex / grok commands or use a fixed model list.

Start background `ai-route` runs with `scripts/dispatch-agent.mjs start <id> -- <command>`: it starts the command outside the process group, checks the process right away and writes a status file (tasks started with `( ... & )` / `nohup` are killed by the process-group cleanup at the tool-call boundary). Before reporting, run `check <id>` to read the status file; a task started directly has no status record and check reports that the process does not exist (#1556).

## 4. Model rules

- Use only models with a 1M context.
- Do not use: extra models, gpt-6-astra (codex too; keep its original model), the GPT 5.6 series, older-generation models, MiniMax M3, DeepSeek V4 Flash.
- Allowed: glm-5.3, glm-5.3-flash, deepseek-v4.1-flash.
- The company Claude route hits its quota about every 6 hours; switch executors when it does.

## 5. Progress summary (goes stale; issues are the source of truth)

- Main line: the spec 28 bootstrap loop (ADR 0021), tickets #1401 to #1409; P4 to P8 not started. The ledger in spec 28 section 8 lags slightly.
- Eval loop: #1510 to #1519.
- Harness A/B eval #1532: weak model glm-5.3-flash against strong model glm-5.3; first the rubric and baseline, then the full comparison after #1511 to #1514 merge.
- Process-error retros: ledger `docs/lessons/`; follow-ups L1 `pnpm prepush` (#1533), L2 fail→fix detector (#1535, depends on E0), L3 interception counts and recurrence escalation (#1534). Tickets that touch AGENTS.md are merged by the human.
- Comment discipline #1520. Legacy comments are being deleted (not translated) and legacy Chinese docs translated to English in batches.
- Known: 150+ stale remote branches to clean up; cloud builds of better-sqlite3 need `npm i -g node-gyp` first.
- cairn cannot merge its own PRs: chief's merge_builds is hard-refused (`chief.ts`); the human clicks "Done" (`完成`) in the web UI.

## 6. Takeover checklist

1. Read `AGENTS.md`, this file and `docs/lessons/README.md`.
2. Look at `.claude/skills/`: `pr-cairn` (PR bodies), `retro-cairn` (wrap-up retro), `verify-cairn`, `verify-step-claim`.
3. Run `gh issue list` for tickets in flight and pick the next one from the spec 28 main line or the eval loop without waiting for someone to prioritize.
