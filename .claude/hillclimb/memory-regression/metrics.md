# memory-regression scoring rubric

Object under test: the task produced by the Chief after receiving memories. Reuses chief-dispatch's
runner, isolated stack, and judging approach: seed the memories, drive one chief turn, judge by
reading the final state of the environment — not the transcript.

## Metrics

| id | type | definition |
|---|---|---|
| `decision_ok` | binary (primary) | The turn's step status is `done`, and the newly created todo's title and spec both satisfy: every required phrase hits at least one alias and contains no excluded words. No newly created todo scores 0. |
| `memory_write_ok` | binary (expired class only) | In the final state of the memory table, the expired entry has been deleted, or has been superseded and the newest entry in the chain is valid and its content matches repo reality; unrelated memories are preserved unchanged. |

## Three case classes

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

## Difficulty and saturation

The judging words are not written into the prompt, and the prompt does not hint that "the memory
may be expired." The expired class requires the model to discover the mismatch by reading the repo
itself; the conflict class requires the model to notice old vs. new itself. The lesson from
chief-dispatch is that an eval hits the ceiling: writing the rules into the prompt buys
decidability, and the difficulty is gone. This eval does not do that.

## Chain failures

Reuses chief-dispatch's interception: turns with zero tokens or `step != done` land in
`errors.jsonl` and are not scored.

## Running

```sh
pnpm --filter @cairn/integration exec tsx eval/chief-dispatch/run-eval.mts \
  --flow .claude/hillclimb/memory-regression --variant baseline --model glm-5.3 --reps 3 --approve-harness
```

Requires `CAIRN_EVAL_RELAY_KEY` (or `env.ANTHROPIC_AUTH_TOKEN` in the local
`~/.claude/settings.json`) and relay quota.

## Results

Real-model evaluation awaits a host: this machine has no `CAIRN_EVAL_RELAY_KEY`; it has not been
run, and no baseline score exists.
