# #1260 chief demotion to a regular agent, live acceptance evidence

probe: `drive-1259-1260-binding.mjs` (shares one stack and one script with #1259; stack =
a launch.mjs isolated instance + a fresh library; zero daemon, zero LLM — the chief-round data face is the same shape as a real machine's, and all claims go through the real machine wire). Result: **27/27 checks PASS**;
the artifacts live in `docs/verify/1259/` (the two tickets share one stack and one run; the screenshots and JSON are the same copies).

## Scenario

After the chief binds a bedding agent (home machine `verify-home-1259`), the chief step's destination, slot and model all read that agent's own configuration.

| leg | action | criterion (evidence files) |
|---|---|---|
| A4 route demotion | a chief round is enqueued → another machine claims empty-handed, the home machine claims it | `a-claims.json`: the chief step's kind=chief, machineId=home, the payload's modelId = the bound agent's own value (no override slot) |
| B slot occupancy | home machine maxConcurrent=1 + a chief step running → another claim comes back empty | result.json `B1` (a chief step occupies a machine slot; at full capacity it queues) |
| F4 drawer | the model row is read-only (the bound agent's own model value, no override trigger button) | `f4-chief-drawer.png` + result.json `F4` (the `总管主模型` button count = 0) |
| F5 settings face | the Agent tab's read-only info card `模型与归属机跟随绑定 Agent` is present; the compaction-model / machine selectors are retired | `f5-chief-settings.png` + result.json `F5` |

The affinity trio (#863/#862 T1/#895) and the override slots (model/compactionModel/thinkingLevel)
retirement faces = zero grep hits + wire-face 400s (the server `chief-settings.test.ts` retired-slot family cases; `machine-concurrency-chief.test.ts` flips and pins the slot-occupancy semantics).

## Rerun recipe

```sh
node .claude/skills/verify-pacman/scripts/launch.mjs
node .claude/skills/verify-pacman/scripts/drive-1259-1260-binding.mjs
node .claude/skills/verify-pacman/scripts/cleanup.mjs
```

## Unit / e2e faces

- server: `test/chief-demotion.test.ts` (9 failure-mode-first cases: route source swap / machine-slot occupancy /
  agent-slot occupancy / no inheritance / retired-slot wire / the sweep hang face — after the #1257 ruling it is a hang assertion,
  the step stays pending and produces no failure row) + `chief-abandoned-sweep` /
  `machine-pin` / `chief-settings` flip rewrites; `chief-affinity` /
  `chief-model-slot` deleted with the mechanism's retirement.
- shared: the snapshot rebirth = pure retired-slot deletion (the chief record's four keys + the PATCH slots + the claim payload's
  reworkContext).
- web: `chief-settings.spec.ts` absorbed (the selector-family tests deleted, the info-card pin added) +
  `chief-send-fallback.spec.ts` deleted with the fallback chain.
