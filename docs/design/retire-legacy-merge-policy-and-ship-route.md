# Retire legacy merge-policy, ship-route, and /api/prompts (#5337)

## Decision

The merge-settings surface predates `/api/projects/:id/autonomy` and has zero
callers. Retire it completely:

- Routes: `GET/PATCH /api/projects/:id/merge-policy`,
  `GET/PUT /api/projects/:id/ship-route`, `GET/PUT/DELETE /api/prompts*`.
- Persisted columns: `team.namedPrompts`, `gate_state.policy`.
- `custom` ship-gate flow: `services/ship-gate.ts` and its instruction pinning,
  claim-time re-verify, landing verify, and abandoned-step sweep.
- `mergePolicy` / `requireUpToDate` project policy gates and the
  `policy-human` / `pr-behind-base` blocker codes.

## Preserved

- Explicit merges: `requestMerge` dispatch on `repoKind` — GitHub PR via
  `mergeThroughGithub`, local projects via `enqueueLocalMerge`, hosted projects
  via a merge step with `buildHostedMergeInstruction`.
- `claimAutonomousMerge(db, buildId, true)` explicit admission,
  `autonomous_merge_admission` dedupe, autonomy-pause and daily-cap brakes.
- `localChecks` (read by `local-merge.ts`, `local-merge-facts.ts`,
  `machine-claim.ts`), `planAutoApproveEnabled`, and
  `GET/PATCH /api/projects/:id/autonomy` (`autonomy-gates.ts`).
- `CONTINUE_PROMPTS.merge` / `REVIEW_GATE_HEAD` default prompt text;
  `parseLocalMergeInstruction` (the `"local-merge"` step protocol).

## Paths that read or write the retired state

- `team.namedPrompts` (JSON): written only by `putNamedPrompt`/`resetNamedPrompt`
  via `/api/prompts*`. Read by `resolveNamedPrompt` -> `reviewInstructionOf`
  (review-step prompt override) and the `ship` prompt in `requestMerge`'s custom
  branch. Removing the column deletes the write surface; both readers go away
  with it.
- `project.autonomy` JSON keys `mergePolicy`, `requireUpToDate`, `shipRoute`:
  read via `projectMergeConfigOf` / `projectShipRouteOf`; written via
  `updateProjectMergeConfig` / `updateProjectShipRoute` (routes die). Stale keys
  in existing `autonomy` JSON are ignored — `projectMergeConfigSchema` keeps only
  `planAutoApproveEnabled` and `localChecks` and drops unknown keys.
- `gate_state.policy`: written by `merge-gate-run` from `readiness.policy`, read
  back by `readMergeGateState` and `planGateStatusWrite`. With `MergePolicy`
  gone the field is a constant — dropped in the same migration.
- `gate_state.blockers` rows may contain `policy-human` or `pr-behind-base`:
  `mergeReadinessSchema.safeParse` then fails, `readMergeGateState` returns
  null, and the next gate run writes a fresh evaluation. This is the same
  fail-closed path as an unreadable row today.

## Behavior changes

- `mergeReadiness` input `policy` shrinks to `{ autonomyPaused, dailyCapReached }`;
  output drops `policy`. `GateInputs.policy.mergePolicy === 'human'` and the
  `requireUpToDate` / `pr-behind-base` checks are gone — `Synced` is no longer a
  gate requirement (TLA model updated: `RequireUpToDate` constant removed).
- `autonomousMergePolicy(db, teamId, now, excludeBuildId)` drops its `config`
  parameter; every project counts toward the daily cap and observes the
  autonomy pause. `claimAutonomousMerge` no longer early-returns on non-
  autonomous policy — non-explicit merges always claim admission.
  `settleAutonomousMerge` always records.
- `plan-auto-confirm` no longer refuses on `mergePolicy === 'human'`;
  `planAutoApproveEnabled` is the remaining project gate.
- `requestMerge` dispatches on `repoKind` only: PR -> GitHub merge, `local` ->
  `enqueueLocalMerge`, `hosted` -> hosted merge step. The `custom` route,
  `judgeShip`, `hasGithubPr`, `appendShipGateInstruction` and
  `CUSTOM_NEEDS_PR` are deleted.
- `reviewInstructionOf` is deleted; `buildReviewStepPrompt` drops its
  `instruction` parameter and always emits `REVIEW_GATE_HEAD`.
- `machine-claim` drops `reverifyShip`; `machine-finish-step` drops
  `verifyShipLanding` (a merge step's success is its reported status);
  `build-abandoned-sweep` drops the ship-instruction filter and
  `sweepAbandonedShipSteps`; `scheduler` drops the sweep call. A custom merge
  step in flight at upgrade loses instruction enforcement — its prompt still
  pins the judged head, and ordinary claim/finish/abandoned handling applies.
- `OWNER_ONLY_EXCEPTION_IDS` drops `rest.merge-policy` and `rest.ship-route`.

## Migration

`0199_retire_merge_policy.sql`:

```
ALTER TABLE team DROP COLUMN namedPrompts;
ALTER TABLE gate_state DROP COLUMN policy;
```

Upgrade test: migrate to 0198, seed `team.namedPrompts`, a `build`, and
`gate_state` rows (policy + blockers), run all migrations, assert both columns
are gone and surviving `team`/`gate_state` rows keep their other values.

## Failure paths

- Old gate_state blocker rows with retired codes parse as no state -> re-run.
- An old in-flight `custom` merge step finishes without the ship landing
  verify; the merge still reports its own status.
- `planGateStatusWrite` loses the `policy-human` refusal; `human` policy can no
  longer be expressed anywhere.
