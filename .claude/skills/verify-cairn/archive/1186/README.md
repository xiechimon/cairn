# #1186 skill injection preconditions

Live verify stack (`VERIFY_PORT` 8791, fresh `PACMAN_HOME`). Stub LLM plus a real daemon. Two agents on the enrolled machine:

| agent | skillsAllowlist | task text names | stub reads SKILL.md |
|---|---|---|---|
| 1186-open | `["demo-skill"]` | demo-skill | no (bash writes README.md, then stop) |
| 1186-closed | `[]` | demo-skill | no |

Before the fix (`before/result.json`, 5/5 on the pre-fix server):

- catalog log is only `catalog: entries=N chars=N bytes=N` (`before/skills-log.txt`)
- `step.skillInjection` is the claim-time hit list (`before/open-step.json` hits demo-skill; `before/closed-step.json` hits `[]`)
- no message contains `skill_injection_check`

After the fix (`after/result.json`, 6/6):

- both steps stay `done` (the check does not change the step outcome)
- open system row is yellow `injected-unread` for `demo-skill`, reds empty, `injected: ["demo-skill"]` (`after/open-check.json`)
- closed system row is red `allowlist-closed`, `injected: []` (`after/closed-check.json`)
- `step.skillInjection` is still the requested hit list, not the post-budget set

Unit repro before the assertion existed: `unit-fail.txt` (7 failed: empty allowlist stayed `ok`, injected-unread stayed `ok`). After: `packages/shared/test/skill-injection-check.test.ts` 12/12, daemon catalog name callback, server `finishStep` yellow/red/ok with the step still `failed` in that harness.

```sh
node .claude/skills/verify-pacman/scripts/cleanup.mjs
node .claude/skills/verify-pacman/scripts/launch.mjs
env -u http_proxy -u https_proxy -u all_proxy NO_PROXY='*' \
  node .claude/skills/verify-pacman/scripts/drive-1186-skill-injection.mjs
```

The probe writes evidence to `/tmp/1186-after` and exits. Rerun on a fresh launch so the server process is the tree under test (tsx, no watch).
