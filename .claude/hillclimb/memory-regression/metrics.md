# memory-regression scoring rubric

Object under test: the task produced by the Chief after receiving memories. Reuses chief-dispatch's
runner, isolated stack, and judging approach: seed the memories, drive one chief turn, judge by
reading the final state of the environment — not the transcript.

## Metrics

| id | type | definition |
|---|---|---|
| `decision_ok` | binary (primary) | The turn's step status is `done`, and the newly created todo's title and spec both satisfy: every required phrase hits at least one alias and contains no excluded words. No newly created todo scores 0. |
| `memory_write_ok` | binary (expired class only) | In the final state of the memory table, the expired entry has been deleted, or has been superseded and the newest entry in the chain is valid and its content matches repo reality; unrelated memories are preserved unchanged. |
| `untouched_ok` | binary (adjacent class only) | The named unrelated memory is still present, its content matches the seed, and both `invalidAt` and `supersededBy` are empty. A missing, edited, or superseded row scores 0. The applicable row does not have to be updated. |

## Case classes

- Conflict (`c01`–`c07`): the store holds two contradictory memories, old and new. In `c01`–`c04`
  the old entry carries `invalidAt` and `supersededBy` and is filtered out at injection time; in
  `c05`–`c07` the old entry was merely created earlier, and both are injected. Judge: the output
  trusts the new entry.
- Cross-project leakage (`l01`–`l07`): a project-specific convention hangs under another real
  project's name, while the task belongs to `eval-project`. Judge: the output does not contain
  that convention. `composeChiefSystemPrompt` injects memories without project scoping — each is
  rendered only as `- 标题：内容` (`- title: content`) — so the other project's memory names
  `other-project` itself in the title (`l01`) or the body (`l02`–`l07`); otherwise the model has
  no way to tell them apart. Each case's required phrases come from repo reality or this project's
  own memories; an empty task cannot pass.
- Expired (`s01`–`s07`): the commands, ports, and versions in the memory do not match the scenario
  repo's reality. Judge: the output defers to repo reality and repairs the memory
  (`update_memory` or `delete_memory`). Each case carries one unrelated memory; a mistaken delete
  or modification scores 0.
- Adjacent (`a01`–`a06`): two memories share `eval-project` and overlap in title or content, but
  they apply to different scopes (design review vs incident response, code-change pre-push vs
  docs-only, and the same shape for port, runtime, deploy, and CI). The required phrase is in the
  applicable memory or the scenario repo. An excluded phrase lives in the other memory. Judge:
  `decision_ok`, plus `untouched_ok` on the unrelated row. `save_memory` returns overlap
  candidates and does not delete; picking `update_memory` on the unrelated candidate scores 0.
- Irrelevant (`i01`–`i06`): a memory in `eval-project` has nothing to do with the task. Its
  distinctive token is excluded. The required phrase is in the scenario repo and is absent from
  that memory, which is the no-memory answer without a second arm. Judge: `decision_ok` only.

## Difficulty and saturation

The judging words are not written into the prompt, and the prompt does not hint that "the memory
may be expired." The expired class requires the model to discover the mismatch by reading the repo
itself; the conflict class requires the model to notice old vs. new itself. The adjacent prompt
does not name which row to leave alone. The irrelevant prompt does not say the memory is off
topic. The lesson from chief-dispatch is that an eval hits the ceiling: writing the rules into
the prompt buys decidability, and the difficulty is gone. This eval does not do that.

A case that every roster model fully passes at one rep is not kept. For adjacent, a full pass is
`decision_ok` and `untouched_ok`. For irrelevant, a full pass is `decision_ok`. A harness error
is not a pass.

## Chain failures

Reuses chief-dispatch's interception: turns with zero tokens or `step != done` land in
`errors.jsonl` and are not scored.

## Running

Source `~/.cairn/tools/eval-env.sh` in the same shell before a real-model run. It exports the
relay URL and key for the non-Claude models Cairn's agents use. Do not print, log, or commit
the key.

```sh
source ~/.cairn/tools/eval-env.sh
pnpm --filter @cairn/integration exec tsx eval/chief-dispatch/run-eval.mts \
  --flow .claude/hillclimb/memory-regression --variant baseline --model glm-5.3 --reps 3 --approve-harness
```

`--variant` is `baseline` or `v<N>`. The roster model goes in `--model`.

## Weekly re-run

A systemd user timer on this machine runs the suite once a week. The unit files and the script
are outside the repo, and the repo does not hold the relay secret.

- Timer: `~/.config/systemd/user/cairn-memory-regression.timer`. `OnCalendar=Mon *-*-* 15:17:00 UTC`
  (Monday 15:17 UTC), `Persistent=true`.
- Service: `~/.config/systemd/user/cairn-memory-regression.service`. It sources
  `~/.cairn/tools/eval-env.sh`, then execs `~/.cairn/tools/weekly/memory-regression.sh`.
- The script fetches `origin/main` into a throwaway worktree, installs dependencies, and runs
  each roster model at `--reps 1`, `--concurrency 2`, `--timeout-s 360`, with `--variant v1`,
  `v2`, and so on, plus `--model`. It copies `results.jsonl` and `errors.jsonl` to
  `~/.local/state/cairn-memory-regression/<UTC date>/<model>/`, then removes the worktree.
- Log: `~/.local/state/cairn-memory-regression.log`.

## Results

Suite scores are the weekly archives above. This file does not copy them.
