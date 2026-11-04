# learn-from-correction

Measures the step memory-regression skips. A person corrects the chief once. The next similar task, in a new chief thread with no transcript carried over, should use the corrected fact. `pnpm traj:reflect` is scored on the same round.

Facts in these cases are absent from the chief-dispatch repo seed. A model cannot pass the empty-memory arm by reading the seed.

## Arms

Each case has a round-1 prompt, a scripted correction, and a round-2 prompt in different wording. Round 2 does not name the fact. Grading reads the database, not the transcript.

- `no-memory`: round 2 only, memory table empty. This is the baseline mistake rate.
- `correction`: round 1, then the correction as a chief chat follow-up, then round 2 on a new thread. Whatever round 1 left in memory is what this arm scores.
- `oracle`: the case's oracle memory is inserted on the chief agent, scoped to the eval project, then round 2 runs. This is the upper bound.

`decision_ok` for `--arm all` is the correction arm's round-2 score. The runner prints one headline when that arm was scored: repeat rate is `1 - decision_ok`, and gap closed is `(correction - no-memory) / (oracle - no-memory)`. Gap closed is `n/a` when oracle ties no-memory.

## Grades

`decision_ok` is 1 when the chief step finished `done`, at least one new todo exists, every include group hits an alias in the new todo title or spec, and no exclude marker appears. No task, an unfinished turn, or a spec that states the mistake scores 0.

`memory_saved_ok` is 1 when a memory row states the corrected fact, does not state the mistake, has `invalidAt` null, and `projectId` equal to the eval project. The same fact stored globally or on another project scores 0. An invalidated row does not count.

`reflect_fact_ok` is 1 when a `traj:reflect` candidate title or content states the corrected fact. `reflect_wrong` is 1 when any candidate states a mistake marker. A dead chief turn is a harness error and is not scored. A reflector HTTP failure is an unscored error.

The live correction is a chat follow-up (`POST /api/conversations/:id/messages`). A plan-gate rejection records build feedback and replans that build. It does not wake the chief and does not write `agent_memory`. The reflection sub-family builds a trajectory pack from round 1 whose plan judgment is `revision` with the correction as the reason, then calls `reflectPacks`. Candidates stay candidates. They are not inserted into `agent_memory`.

The chief system prompt injects every valid memory of the bound agent, with no project filter. The oracle arm still relies on that injection. `memory_saved_ok` does not: a correct fact with a null `projectId` fails.

## Run

```sh
source ~/.cairn/tools/eval-env.sh
pnpm --filter @cairn/integration exec tsx eval/chief-dispatch/run-eval.mts \
  --flow .claude/hillclimb/learn --variant v1 --model glm-5.3 \
  --arm all --reps 1 --concurrency 2 --timeout-s 1200
```

The relay key stays in the environment. Do not print it, log it, or commit it. Use one variant directory per model. The resume key is the case id and the rep, not the model, so a second model in the same directory skips every finished case. `--arm no-memory` scores only the empty-memory baseline. `--approve-harness` records a sha in `_state.json` and rewrites `harness_paths` to the chief-dispatch harness list. Run that flag on a throwaway worktree, not in a checkout you will commit.

## Weekly re-run

User units `cairn-learn-eval.service` and `cairn-learn-eval.timer` live under `~/.config/systemd/user`. The service sources `~/.cairn/tools/eval-env.sh` and execs `~/.cairn/tools/weekly/learn-eval.sh`. The key is not in this repo, the unit file, or the log line. The timer is Wednesday 15:17 UTC (`OnCalendar=Wed *-*-* 15:17:00 UTC`, `Persistent=true`) so it does not overlap the Monday eval timers at 15:10 and 15:17 UTC. The script fetches `origin/main` into a dated worktree under `~/lanes` and removes it on exit. Until this family is on main, the weekly run exits because `.claude/hillclimb/learn/cases.json` is missing. Archives go to `~/.local/state/cairn-learn-eval/<yyyymmdd>/<model>/`.

## Screen

Run the no-memory arm once per roster model before keeping a case. Drop a case when every model that finished scores `decision_ok` 1. A harness error is not a miss and does not count. `1` means the empty-memory turn already stated the fact. Use one variant directory per model. The resume key is the case id and the rep, not the model.

```sh
source ~/.cairn/tools/eval-env.sh
pnpm --filter @cairn/integration exec tsx eval/chief-dispatch/run-eval.mts \
  --flow .claude/hillclimb/learn --variant v1 --model glm-5.3 \
  --arm no-memory --reps 1 --concurrency 2 --timeout-s 400
```

Record the `decision_ok` grid in this section after that pass. The cases in `cases.json` are the candidate set for that pass.
