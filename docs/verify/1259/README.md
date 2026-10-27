# #1259 agent home-machine binding, live acceptance evidence

probe: `drive-1259-1260-binding.mjs` (a verify-pacman custom probe, sharing one stack and one script with #1260; stack = a launch.mjs isolated instance, server 8792 + web 5274 + an independent PACMAN_HOME fresh library —
8791/5273 were held by another lane, so per port discipline we moved along; zero daemon, zero LLM — the dispatch face goes entirely through the real machine wire, and the UI face through a real browser). Result: **27/27 checks PASS** (`result.json`).

**2026-10-13 post-merge rerun** (after main merged the #1257 hang semantics, stack 8806/5286): **28/28
checks PASS** — legs A/C/D/F byte-identical criteria (routing / slot occupancy / rebinding / lifecycle / UI closed loop zero regression);
leg E per the #1257 ruling switches to hang semantics: a legacy step without a home machine **no longer fails**, and after a scheduler tick it stays pending +
`build.errorMessage` empty + the board's `waitingOn = {on:"machine"}` (the todo record in `e-legacy-sweep.json` carries it live). The same-named files in this directory have been overwritten with the rerun's artifacts (`result.json` = the rerun's ground truth).

## Scenario

Two machines each hold their own api-key (`verify-home-1259` / `verify-other-1259`, each reporting a claude-code model inventory at enroll: home has `stub-cc-model`, the other has `stub-cc-other`);
an agent is born bound to a home machine (required at creation, missing → 400).

| leg | action | criterion (evidence files) |
|---|---|---|
| A routing | create (machineId required) → todo+build + chief round → another machine / the home machine claim | `a-claims.json`: the other machine's 75s long-poll comes back empty, the home machine claims the build step and the chief step in turn (kind + machineId) |
| C rebinding | rebinding a claude-code agent to a machine missing the model → 400; a legal rebind → new steps are rerouted immediately | result.json `C1` (the 400 copy contains the model id `stub-cc-model`) / `C3` (the old machine claims empty-handed) / `C4` (the new machine claims it) |
| D lifecycle | deleting a bound machine → 409 naming it; whole-machine evacuation (eligible machines move away, model-mismatched ones stay with a reason on the machine list); after evacuation the delete returns 204 | `d-evacuate.json` (the evacuate response + the SQLite agent rows' machine attribution before/after) |
| E legacy fallback | a direct DB insert of a legacy agent without a home machine + aging its pending step → the scheduler tick sweeps | `e-legacy-sweep.json`: the step stays pending (the #1257 hang) + errorMessage empty + waitingOn `等机器` (the post-merge rerun criterion) |
| F UI closed loop | the machines list row's machine name → the detail page (the fact bar + the attribution grid + the create dialog with the home machine preselected) | `f1-machine-detail.png` / `f3-create-dialog.png` |

## Rerun recipe

```sh
node .claude/skills/verify-pacman/scripts/launch.mjs          # start the isolated stack (fresh library)
node .claude/skills/verify-pacman/scripts/drive-1259-1260-binding.mjs
node .claude/skills/verify-pacman/scripts/cleanup.mjs
```

## The real mea chain (a real daemon + the real claude-code CLI)

The branch stack is deployed on mea itself (`/home/measure/pacman-verify`, 8792/5274, a scratch
PACMAN_HOME with zero contact with the user's live stack) + a real daemon (`mea-wsl-verify`, claude 2.1.285).
The browser probe runs on mea itself (on the tailnet the vite dev module graph takes minutes, with an HTTP/1.1 six-connection ceiling — the probe relocation is a topology fix, not a test-content change).

- Cascade visibility (`mea-1..5` screenshots): the detail page's create slot preselects the home machine; after choosing the claude-code runtime at runtime, the model inventory = what mea's settings.json self-reports (fable /
  deepseek-v4.1-flash[1M] / qwen3.8-max-0902[1M] / gpt-5.6-luna[1M] /
  MiniMax-M3[1M]) — the hard answer to "can you see mea's runtime and pick its models" = yes.
- A real task (`mea-real-task.txt`): an agent bound to mea + a qwen model, the todo "append today's date to the end of the README" really run to completion by mea's claude — the `verify-target` repo's real artifact:
  commit `4404316 docs: append today's date to README`, the README's last line `2026-10-12`.
- Boundary record (not this PR's bug): mea's `fable` alias resolves to
  deepseek-v4.1-flash, and the gateway refuses it (no permission) — the reported inventory ≠ gateway reachability; the binding-model gate governs the former, the latter is a machine-side configuration issue (the user is aware).

## Unit / e2e faces

- server: `test/agent-home-machine.test.ts` (8 cases) + `test/machine-exit.test.ts`
 (6 cases) + `test/machine-pin.test.ts` rewritten for the home-machine version + all existing regressions green.
- web: `e2e/team-create-agent.spec.ts` + `e2e/agent-create-model.spec.ts` (three-level cascade) + `e2e/machine-detail.spec.ts` (4 cases) + `e2e/machines-local.spec.ts`
 (the row-link narrowing pin); the full e2e 891 green.
