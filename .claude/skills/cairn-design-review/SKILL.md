---
name: cairn-design-review
disable-model-invocation: true
description: Manually invoked cross-domain interface review of a Cairn surface or a UI diff — accessibility, layout, copy, type, colour, polish and motion — returned as one report ranked by user impact, with every finding keyed to a DESIGN.md rule id. Read-only; run only when a whole-surface review or a change-scoped interface review is asked for. Building UI goes through design-cairn.
---

# cairn-design-review

A review is two of Jakub Krehel's skills, vendored verbatim at `jakubkrehel/skills@672ae44ace6aaed65b86cbb1e2fd6fbea0e79578` (MIT, `upstream/LICENSE`), with Cairn's domains and rule ids in place of his generic routing. Each upstream `SKILL.md` is vendored as `README.md`; links inside the vendored files that say `SKILL.md` point at that sibling `README.md`.

| The request | Read | It owns |
|---|---|---|
| Review a whole surface, panel or flow | `upstream/better-interface/README.md` + `review-format.md` | Scope resolution, the domain order, escalation triggers, severity, consolidation, the cap and the verdict |
| Review a change before it lands | `upstream/interface-review/README.md` + `scope-resolution.md` + `removed-signals.md` | The scope block, blast radius, reading removed lines, `Introduced` / `Regression` / `Pre-existing` |

A change review hands its findings to the surface review's severity scale, cap and format; it never invents its own.

## Cairn overrides

Where the vendored workflow names something Cairn does not have, this table replaces it. An entry not listed applies as written.

- **The domains are Cairn's wrappers, in this order.** Accessibility `cairn-a11y`, layout and colour `cairn-polish`, copy `cairn-copy`, type `cairn-type`, polish `cairn-polish`, motion `cairn-motion`. Load each one and read the vendored upstream it routes to; a domain whose wrapper never loaded is `Not reviewed`, with its name, not `Clear`.
- **Every finding names a rule id.** Each finding carries the id it breaks from the `## Rules` sections of `apps/web/DESIGN.md` and `docs/design/surfaces/*.md` (`node scripts/design-rules-for.mjs --ids` lists them all), or `no rule` as a candidate for a new `M` row. The id is what a lane fixes and what the brief lists.
- **Escalation triggers keep their ids.** A control with no accessible name is C4; a keyboard-reachable control with no visible ring, or a pointer-only path, or motion that ignores reduced motion is A2; content clipped at 390px is R1; a failing contrast pair is A3 with V28 for the dark layer; meaning carried by colour alone is V5; a destructive action with no confirmation, undo or distinct treatment is C25; truncated content with no way to the full value is L4; an error that names no recovery is C5; a state change carried by motion alone is V24. A trigger is HIGH on sight and exempt from the cap, exactly as upstream says.
- **A change scope is a git range, not a pull request.** Cairn lands through `queue/main` and has no PRs, so accept a branch, a commit range, `uncommitted`, or a range the owner names. With nothing named, use `git merge-base origin/main HEAD`..HEAD plus the uncommitted changes and record the base commit in the scope block.
- **Read-only means the tree too.** Never `git checkout`, `git switch`, `git stash` or `git reset --hard` — those rewrite files another lane may be holding. Read another ref with `git show`, and render a diff in an isolated `git worktree add` when a rendered check is asked for.
- **Evidence is the live stack.** A visual finding cites a screenshot from a `verify-cairn` stack at 1440 and 390, light and dark; a fixture screenshot is labelled `fixture` and never stands in for the live one. A claim you could not render is `Not verified`.
- **The cap is 15 findings, with at most three pre-existing ones** as courtesy, and one row per root cause with every confirmed location in it. A report that finds nothing is a complete report.
- **Read-only by default.** Fixing is a separate change; when the owner asks for the fix, the consolidated report is the scope and the relevant specs run again afterward.

## Before wrap-up

Report in the vendored format: the scope block for a change review, then the coverage table, the findings table with rule ids, verification and the verdict. An `Approve` means every domain actually ran and every claimed check actually ran; anything else is `Not reviewed` or `Not verified`, spelled out.
