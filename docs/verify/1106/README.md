# #1106 dispatch skill injection — verification evidence

Ticket: skill injection into the dispatch pipeline (coarse distribution by catalog + description-triggered injection into the task brief).
Mechanism: at a worker step's claim (= the assembly-and-delivery slot of the task brief, the same position as the #823 chief route),
the server runs a rule selection over "task text (title+spec) × the granted set" (the candidate base = the granted set's canon;
the server's live scan only joins descriptions — a granted skill from the daemon's local library participates by id/name),
and the result lands atomically with the same claim on the step row (the `skillInjection` column, carrying each hit's rule and reason);
the ids pass through the claim payload's `agent.injectedSkills` to the daemon, which narrows the catalog injection (the daemon half is pinned by apps/daemon unit tests, see below).

Probe: `.claude/skills/verify-pacman/scripts/drive-1106-skill-inject.mjs`
(wire phase — live stack + bare HTTP playing the machine + a browser detail face; no daemon/LLM dependency).
fixture: 21 granted skills (the ticket's ≥20 magnitude; front-end / testing / debugging domains + a job-hunting / knowledge-base unrelated family).

## Results

| leg | stack | result |
|---|---|---|
| after | this branch (8791/5273) | 17/17 PASS (`after/result.json`) |
| before | a throwaway origin/main worktree (8793/5275) | 8/17 — the 9 FAILs = the mechanism-absent baseline (`before/result.json`: the payload has no `injectedSkills`, the step table has no `skillInjection` column, the detail face has no injected-skills row) |

## Acceptance → artifact path

| ticket acceptance | criterion (the result.json check name) | artifact |
|---|---|---|
| 1 ≥20 skills, only the relevant ones injected | "the injection contains only relevant skills": a domain task's injection = [better-colors, better-layout, better-typography, kami] (the front-end domain), the 12 job-hunting / knowledge-base family zero injections | `after/claim-domain.json` (agent.injectedSkills vs agent.skills=21) |
| 2 the agent can answer "why wasn't an uninjected skill used" | the injection ⊆ the granted set + the uninjected skills' descriptions do not enter the brief (the selection face sees only 4/21) | `after/claim-domain.json`; the daemon catalog-narrowing unit test `apps/daemon/test/skills-catalog.test.ts` #1106 block (selected entries' full text, unselected entries filtered out of the catalog, the deny face not narrowed) |
| 3 zero hits dispatch normally | claim 200 + `injectedSkills=[]` + the step row `hits=[]` + the authorized set still full | `after/steps-zero.json`, contrasted with `after/claim-domain.json` |
| 4 the selection process inspectable on the detail face | the steps REST + the SQLite step row carry the rules and reasons; a browser DOM assertion + a screenshot | `after/steps-domain.json`, `after/result.json` (the SQLite row consistency check), `after/detail-domain.png` (the injection row with skills and reasons), `after/detail-zero.png` (the `未注入技能` placeholder) |
| fine trigger: an explicit mention | the task text names tdd → the injection contains tdd, rule=explicit-mention, the reason names the task text | `after/claim-mention.json`, `after/result.json` |

## Hit-reason artifacts (after/result.json)

A domain task ("fix the board card's font size being too small and the line-wrap overflow") has four hits, all domain rules,
each reason naming both the task-side and the skill-side keywords, e.g.:

> better-typography — the task text and the skill share the domain "front-end UI" (the task hits `字号`, the skill description hits `ui`)

The zero-hit task ("replace the homepage carousel with a static image"): `hits=[]` lands in the DB (a configuration fact, not a failure),
and the detail face renders `未注入技能（任务文本未命中任何技能）`.

## The daemon half (injection narrowing + description full text), unit-test pin faces

The wire phase proves "the selection canon lands in the DB + the ids enter the payload"; on the daemon side,
the catalog narrows per the selection, unselected entries get `filtered: ... not in injected selection`, a selected entry's description over 200 characters is not truncated, a missing `injectedSkills` falls back to the whitelist's full catalog (zero regression on an old server), and the deny face (#917 authorized hard-block) is unaffected by the selection — pinned by the `apps/daemon/test/skills-catalog.test.ts` `注入选择收窄（#1106）` block's 7 cases (34/34 green).

## Rerun recipe (self-sufficient and reproducible)

```sh
# after leg (this branch):
node .claude/skills/verify-pacman/scripts/launch.mjs                 # 8791/5273, fresh library
node .claude/skills/verify-pacman/scripts/drive-1106-skill-inject.mjs   # 17/17
node .claude/skills/verify-pacman/scripts/cleanup.mjs

# before leg (a throwaway origin/main worktree, 8793/5275):
git worktree add --detach /tmp/pacman-1106-before origin/main
(cd /tmp/pacman-1106-before && corepack pnpm install --prefer-offline)
VERIFY_REPO_ROOT=/tmp/pacman-1106-before VERIFY_PORT=8793 VERIFY_WEB_PORT=5275 \
  node /tmp/pacman-1106-before/.claude/skills/verify-pacman/scripts/launch.mjs
SERVER=http://127.0.0.1:8793 WEB_URL=http://127.0.0.1:5275 \
  SKILLS_DIR=/tmp/pacman-1106-before/.claude/verify-run/home/skills \
  DB=/tmp/pacman-1106-before/.claude/verify-run/home/server/server.db \
  node <this repo>/.claude/skills/verify-pacman/scripts/drive-1106-skill-inject.mjs   # 8/17 (9 FAIL = baseline)

# unit-test faces:
(cd packages/shared && corepack pnpm exec vitest run)   # 323 (incl. skill-inject 17)
(cd apps/server && corepack pnpm exec vitest run test/skill-inject-claim.test.ts)  # 5
(cd apps/daemon && corepack pnpm exec vitest run test/skills-catalog.test.ts)      # 34
(cd apps/web && corepack pnpm exec vitest run test/injected-skills-row.test.ts)    # 5
(cd apps/web && corepack pnpm exec playwright test e2e/skill-inject.spec.ts)       # 3
```

Probe environment prerequisites: a fresh library (launch self-cleans); the skill fixture is self-built by the probe (21 SKILL.md files
land in `<RUN_DIR>/home/skills`); the machine face = a bare-HTTP machine playing with a per-enroll token
(no daemon/LLM dependency).
