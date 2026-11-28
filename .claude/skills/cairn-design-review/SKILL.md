---
name: cairn-design-review
disable-model-invocation: true
description: Manually invoked cross-domain interface and motion review of a Cairn surface or UI diff — accessibility, layout, copy, type, colour, polish and motion — returned as one report ranked by user impact, keyed to DESIGN.md rule ids. Read-only; run only when a surface review, diff interface review, or motion audit is asked for. Building UI goes through design-cairn.
---

# cairn-design-review

A review is two of Jakub Krehel's skills, vendored verbatim at `jakubkrehel/skills@672ae44ace6aaed65b86cbb1e2fd6fbea0e79578` (MIT, `upstream/LICENSE`), with Cairn's rule docs and ids in place of generic routing. Each upstream `SKILL.md` is vendored as `README.md`; links inside vendored files saying `SKILL.md` point at that sibling `README.md`.

| The request | Read | It owns |
|---|---|---|
| Review a whole surface, panel or flow | `upstream/better-interface/README.md` + `review-format.md` | Scope resolution, domain order, escalation triggers, severity, consolidation, cap and verdict |
| Review a change before it lands | `upstream/interface-review/README.md` + `scope-resolution.md` + `removed-signals.md` | Scope block, blast radius, reading removed lines, `Introduced` / `Regression` / `Pre-existing` |

A change review hands its findings to the surface review's severity scale, cap and format; it never invents its own.

## Cairn overrides

- **Read the living rule docs directly (in order).** Start at `apps/web/DESIGN.md` (process rules `P1`–`P7`, token frontmatter, component table), then `docs/design/surfaces/foundation.md` (accessibility, layout, colour, copy, type, polish), the touched surface file(s) under `docs/design/surfaces/`, and `docs/design/surfaces/motion.md`. Run `node scripts/design-rules-for.mjs <paths>` to pull every scoped row. Any unverified area is reported as `Not reviewed`, never `Clear`.
- **Motion audit.** When asked to audit motion (animations to remove/reduce, missing motion, or motion craft in a diff), judge strictly against `docs/design/surfaces/motion.md` (`V24`, `A2`, `C23`, `C24`, `A4`, `R1`): no motion library, bounce `0`, flat instant press tint (only labelled `Button` variants scale to `0.97`), no entry animation on chat messages/list rows/board cards outside `grow-*` and first-run, and check `src/styles/motion.css`, `src/styles/shadcn.css`, and `tw-animate-css`. Claims about feel require replaying a recording at ~0.1x, otherwise mark `Not verified`.
- **Every finding names a rule id.** Key every finding to an id from `node scripts/design-rules-for.mjs --ids`, or `no rule` as a candidate for a new `M` row.
- **Escalation triggers keep their ids.** Missing accessible name `C4`; missing keyboard focus ring, pointer-only path, or ignored reduced motion `A2`; clipped at 390px `R1`; failing contrast `A3` (plus `V28` dark layer); colour-only state `V5`; destructive action without confirm/undo `C25`; truncation without full text access `L4`; error without recovery `C5`; state change by motion alone `V24`. Triggers are HIGH on sight and exempt from the cap.
- **Change scope is a git range, not a PR.** Cairn lands via `scripts/ops/push-queue.mjs`, so accept a branch, commit range, `uncommitted`, or default to `git merge-base origin/main HEAD`..HEAD plus uncommitted changes, recording the base commit.
- **Read-only means the tree too.** Never `git checkout`, `git switch`, `git stash` or `git reset --hard`. Read other refs with `git show`, and render diffs in an isolated worktree if needed.
- **Evidence is the live stack.** Visual findings cite `verify-cairn` live screenshots at 1440 and 390, light and dark (`P7`); fixture shots are labelled `fixture`. Anything unrendered is `Not verified`.
- **Cap and verdict.** At most 15 findings (at most 3 `Pre-existing`), one row per root cause with all confirmed locations. Report in the vendored format (scope block, coverage table, findings table with rule ids, verification, verdict). `Approve` requires every domain and claimed check to have actually run; otherwise spell out `Not reviewed` / `Not verified`.
