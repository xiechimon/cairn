# #903 dispatch judgment — live verification evidence (rework round / round 2)

The ruling canonical copy = `docs/adr/0014-chief-dispatch-verdict-authority-rests-with-chief-overridable.md` (rework round,
overturning round 1's ADR 0013 settings-slot scheme). Probe =
`.claude/skills/verify-pacman/scripts/drive-903-dispatch-judgment.mjs`,
2026-10-08 live **12/12 PASS** (isolated stack 8795/5277, fresh DB, no daemon, no LLM,
fake machine on real machine wire).

Round-1 evidence (the settings-slot face: four ChiefDispatchSelect screenshots + PATCH round trips + clamp proof, 14/14 PASS) was invalidated wholesale when the settings slot was deleted by ADR 0014 D1 and has been removed from this directory — it can be recovered from git history at commit `c16714b3`, and its raw permanent links (pinned to the old SHA) still resolve.

## Assertion → file mapping

| assertion | ruling | artifact |
|---|---|---|
| S0 bedding (project + three todos) | — | `result.json` ids |
| U1 Agent tab has no dispatch-mode row; the neighboring machine/compress-model rows are intact | D1 (no dummy controls left) | `01-settings-agent-no-dispatch-row.png` |
| A1 PATCH dispatchWithPlan alone → 400 | D1 (slot dead state) | `patch-reject-and-envelope.json` |
| A2 PATCH mixed payload → 200 with the key stripped, the envelope carries no dispatchWithPlan | D1 (contract face dead state) | same |
| E1a systemPrompt dispatch-judgment section: Mika's discipline verbatim + the three signals + the review gate always present + dispatchReason + on-the-spot overturn affects only this one time; no hard-wired `withPlan:false` instruction, no settings-synthesis residue | D5/D3/D4 | `claim-e1.json` (the judgment section's two lines verbatim + the run_builds definition) |
| E1b run_builds vocabulary: withPlan + dispatchReason present, only todoIds required | D1/D4 | same |
| E1c/E1d default → withPlan=true + reason null; build.withPlan=1 + first step plan | D2 (fail-safe) | `relay-e1-default-plan.json` |
| E2a/E2b explicit false + reason → response false (no clamp) + reason echoed verbatim; build.withPlan=0 + first step build | D1/D4 | `relay-e2-direct-reason.json` |
| E3a/E3b explicit true + reason → echoed; first step plan | D1/D4 | `relay-e3-explicit-plan-reason.json` |

## Rerun recipe

```sh
env -u http_proxy -u https_proxy -u all_proxy \
  VERIFY_REPO_ROOT=<worktree> VERIFY_PORT=8795 VERIFY_WEB_PORT=5277 \
  node .claude/skills/verify-pacman/scripts/launch.mjs
env -u http_proxy -u https_proxy -u all_proxy \
  VERIFY_REPO_ROOT=<worktree> \
  node .claude/skills/verify-pacman/scripts/drive-903-dispatch-judgment.mjs
```

If a port collides, check the occupant with `lsof -iTCP:8795 -sTCP:LISTEN` first — if another lane holds it, move to the next port, do not kill it. Requires a fresh library: re-verifying = re-launch (launch wipes the run directory).
