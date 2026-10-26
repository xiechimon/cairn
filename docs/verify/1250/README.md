# #1250 verification evidence (persona roster + verify step + three-perspective fan-out + split_todo)

- Probe: `scripts/drive-1250-persona-verify.mjs` (this repo's `.claude/skills/verify-pacman/scripts/`)
- Reading: feature map `features/persona-verify.md`; measured pitfalls `changelog/2026-10-12-1250.md`
- Result: **live 27/27 PASS** (checks itemized ok in `result.json`, zero FAILs)
- Stack coordinates (this round): server `127.0.0.1:8795` / web `127.0.0.1:5277` / PACMAN_HOME
  `…/.claude/verify-run/home` (fresh library, seed user Owner); zero daemon zero LLM —
  a fake machine wire (claim / tool relay / done) + a real-browser click leg.

## Evidence list

| file | content |
|---|---|
| `result.json` | the 27 checks itemized ok/label + stack coordinates + ids |
| `seeding-personas.json` | S phase: the six-member persona rows (persona / contract name / tier / provider / modelId / tools) |
| `verify-step.json` | V phase: the verify-step row (pending + prompt material: evidence directory / output contract) |
| `verify-verdict-message.json` | V phase: the VERIFY_VERDICT message row (a valid conclusion with passed=false + 2 evidence entries) |
| `fanout-steps.json` | F phase: the three review steps (each prompt's meta header carrying a persona agentId) |
| `01-detail-verify-active.png` | browser: the verify step pending → the header chip reads `验证中` |
| `02-detail-verify-verdict.png` | browser: the verdict row `验证未通过` + 2 evidence entries |
| `03-review-dialog-fanout.png` | browser: the AI review dialog shows the `三视角并行审` line |
| `04-detail-fanout-verdicts.png` | browser: the three perspective verdicts land in the session in parallel |
| `05-split-parent-confirm.png` | browser: the parent card stops at confirm (the split-plan document + the split declaration row) |
| `06-split-parent-done.png` | browser: all child cards done → the parent card auto-closes |

## Rerun recipe

```sh
# this lane's port pair (if occupied, move along and update accordingly):
lsof -nP -iTCP:8795 -sTCP:LISTEN; lsof -nP -iTCP:5277 -sTCP:LISTEN
cd <this worktree>
env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  NO_PROXY=localhost,127.0.0.1 \
  VERIFY_PORT=8795 VERIFY_WEB_PORT=5277 \
  node .claude/skills/verify-pacman/scripts/cleanup.mjs   # must clean before re-launch
env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  NO_PROXY=localhost,127.0.0.1 \
  VERIFY_PORT=8795 VERIFY_WEB_PORT=5277 \
  node .claude/skills/verify-pacman/scripts/launch.mjs
env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  NO_PROXY=localhost,127.0.0.1 \
  node .claude/skills/verify-pacman/scripts/drive-1250-persona-verify.mjs
```

Requires a fresh library (re-verify = re-launch). Run `node …/scripts/cleanup.mjs` afterwards to recycle the stack.

## Related evidence faces

- fixture face: `apps/web/e2e/persona-verify.spec.ts` 3/3 (the verdict's three states + the evidence entries + the negative pin that the dialog's fan-out row renders zero; the full e2e 923/923 is in the PR body).
- unit: `apps/server/test/persona-split-verify.test.ts` 12/12,
  `apps/daemon/test/verify-verdict.test.ts` 6/6,
  `packages/shared/test/persona.test.ts` / `verify-prompt.test.ts` /
  `chief-tools.test.ts` (all green inside shared 351/351).
