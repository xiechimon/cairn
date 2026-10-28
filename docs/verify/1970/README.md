# #1970 skills: suppress weak domain signals and path-derived matches

## Scope

- `packages/shared/src/skill-inject.ts`: `domainsOfText` strips URLs and path-like tokens before folding (task and skill sides via `domainsOfSkill`); weak keywords `ci`, `cd`, `api`, `pr`, `ui`, `ux`, `失败` alone do not open a domain; `documentation` added to the docs keyword list. `mentionsSkill` (#1969) unchanged.
- `packages/shared/test/skill-inject.test.ts`: `describe('domain: weak signals and paths (#1970)')`.

## Domain probes (same inputs)

| probe | before (origin/main) | after (this branch) |
| --- | --- | --- |
| `fix the CI job` → aihot | `["aihot"]` | `[]` |
| `see docs/verify/1178/README.md` → docs-writer | `["docs-writer"]` | `[]` |
| `please update the documentation…` → docs-writer | `[]` | `["docs-writer"]` |
| `https://example.com/api/ui` → fe/be | `["be","fe"]` | `[]` |

Source: `domain-probes.json`.

## #1782 grade (provisional catalog)

Same two-skill provisional catalog as #2091 (`e2e-debugging` / `design-review`). `#1967` `replay.mts --snapshot` is not on main; frozen historical sample replay is deferred to that ticket.

```
BEFORE: {"precision":0.8666666666666667,"recall":0.7647058823529411,"forbiddenHits":2}
AFTER:  {"precision":0.8666666666666667,"recall":0.7647058823529411,"forbiddenHits":2}
```

Files: `1782-before.json`, `1782-after.json`. Precision, recall, and forbiddenHits are unchanged. Unrelated-injection decrease on the domain probes is reported separately above; no lost relevant #1782 hits on this catalog.

## Commands

```sh
pnpm --filter @cairn/shared exec vitest run test/skill-inject.test.ts
pnpm --filter @cairn/integration exec vitest run test/skills-routing-grade.test.ts test/skills-routing-e2e.test.ts
pnpm typecheck && pnpm lint && pnpm spec:parse
```

Logs: `unit-red.log`, `unit-green.log`, `routing-green.log`, `typecheck-green.log`, `lint-green.log`, `spec-parse-green.log`.
