# Issue 1799 skill-injection scan

Read-only measurement on 2026-10-26 against the omarchy database at `~/.cairn/server/server.db`. `skill_audit` has 0 rows. The issue text counted 119 steps with a `skillInjection`; this read found 123. The selector was not rewritten from those stored rows. Historical rows are left as they are.

## Stored hits

123 steps carry 3952 hits: 3811 `domain`, 141 `explicit-mention`.

A hit counts as loose when either of these is true:

- The rule is `explicit-mention` and the skill id is one latin token (no hyphen).
- The rule is `domain` and the task keyword or the skill keyword is `ui`, `ux`, `ci`, `cd`, `pr`, `api`, `docs`, `发布`, `失败`, or `错误`, or the skill id is `aihot`.

That rubric marks 2498 hits loose and 1454 hits kept. Explicit mentions: 138 of 141 loose. Domain hits: 2360 of 3811 loose.

The task keywords that open the most stored domain hits are `ui` 901, `docs` 736, `文档` 281, `失败` 220, `分支` 203, `测试` 182, `ci` 127, `e2e` 123, `报错` 111, `test` 111.

Skills with the most loose hits:

| Skill | Loose hits |
| --- | ---: |
| pr | 117 |
| aihot | 95 |
| shadcn | 94 |
| better-writing | 88 |
| better-interface | 85 |
| interface-review | 85 |
| grill-with-docs | 80 |
| kami | 74 |
| emil-design-eng | 71 |
| wizard | 71 |

The most common loose domain pairs are `ui` to `ui` (384), `docs` to `文档` (247), `docs` to `writing` (171), `ui` to `界面` (94), `ci` to `ci` (77), `失败` to `bugs` (62). The reported `aihot` case is in this set: the task keyword `ci` shared the deploy domain with the description keyword `发布`.

## Same 123 task texts, current catalog

78 skills under `~/.agents/skills` have a `SKILL.md`. Descriptions are the one plain frontmatter line the claim path reads. Each task text is the title plus the spec. The before column is the matcher before this change. The after column is the matcher in this worktree. Skill text may have changed since the original claim, which is why the stored total (3952) and the before total (3160) differ.

| | Hits | Domain | Explicit |
| --- | ---: | ---: | ---: |
| Before | 3160 | 3027 | 133 |
| After | 1695 | 1693 | 2 |

1465 hits drop (46.4%). 120 of 123 steps lose at least one hit. No step gains a skill. `aihot` goes from 101 hits to 0 (95 of those steps still have a stored `aihot` hit from claim time).

Largest drops: `aihot` 101, `pr` 86, `shadcn` 70, `better-writing` 64, `wizard` 64, `emil-design-eng` 58, `better-interface` 56, `interface-review` 56, `kami` 56, `diagnosing-bugs` 54.

Still injected most often: `setup-pre-commit` 116, `contributor` 110, `git-guardrails-claude-code` 110, `sync` 110, `why` 101, `tdd` 93, `grilling` 84, `migrate-to-shoehorn` 84, `codebase-design` 63.

## What the matcher does now

Low-signal keywords no longer open a domain and no longer place a skill in one: `ui`, `ux`, `ci`, `cd`, `pr`, `api`, `发布`, `失败`, `错误`. Slash paths and `http` URLs are removed before folding, so a path such as `docs/verify/1178/README.md` does not open the docs domain. The word `docs` itself still does.

A latin skill id matches as an explicit mention only when the folded name is two or more tokens, or the token beside it is `用`, `use`, `skill`, `skills`, or `技能`. A bare `PR`, `reproduce`, or `buttonVariants` does not name the `pr` or `variant` skills. `用 pr 技能` still does. CJK names of at least two characters still match by compact substring.

Domain union across different strong keywords stays. A typography keyword can still inject a color skill, and `vitest` can still inject `tdd`.

## Audit rows

A worker claim that wins the step writes one `skill_audit` row per hit, in hit order. `action` is `inject`, `actorType` is `agent`, `actorId` is the agent id, and `bytes` is the UTF-8 length of the reason. A claim with zero hits writes nothing. A chief claim writes nothing. The existing `skill_audit` table already has `action` as plain text, so this adds no column and no migration.

## Issue 1782

Issue 1782 asks for a labeled precision and recall set under `integration/eval/skills-routing/`. That directory is not in this worktree. `integration/eval/` contains `adoption`, `chief-dispatch`, and `memory-regression`. There is no 1782 score to recompute. The existing true-positive tests still pass, so this change does not lower the routing cases those tests cover.

## Limit

Same-domain bleed remains when a skill description contains a strong keyword the task also uses for another reason. On this replay the frequent leftovers include `why` (via `回归`), `setup-pre-commit` (via `测试`), `contributor` (via `合并`), `sync` (via `提交`), and the `pr` skill (via `writing`). Requiring the same keyword on both sides would also drop the cases where `vitest` injects `tdd` and a typography keyword injects a color skill.

A task whose only frontend signal is `ui` or `ux`, whose only debugging signal is `失败` or `错误`, or whose only deploy signal is `ci`, `cd`, or `发布`, no longer opens that domain.
