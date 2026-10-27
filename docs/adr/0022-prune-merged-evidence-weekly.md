# ADR 0022 · Prune merged evidence from main every week

> Status: **decided** (2026-10-25, ian chose option A' in the repository structure audit thread). Supersedes ADR 0015 (`docs/adr/0015-verification-evidence-stays-in-repo-no-migration-of-existing.md`).

## Problem Statement

`docs/verify/` held 476 folders and 313M on `main`, half of the working tree. ADR 0015 kept it "append only", because merged PR bodies embed SHA-pinned raw links and deleting files does not shrink history. Both facts still hold. What changed is the reader: the repository is public and international now, and a visitor who opens the tree or clones it sees mostly old screenshots, not the product.

Example: `docs/verify/312/` holds review-modal screenshots from 2026-09-28. Its PR merged a month ago; nothing in code reads it; its PR body links to `raw.githubusercontent.com/xiechimon/cairn/<sha>/docs/verify/312/...`, which keeps working after the folder leaves `main`, because the link pins a commit.

## Options considered

| Option | What it costs | Outcome |
|---|---|---|
| Keep ADR 0015 | nothing | the tree keeps growing with evidence |
| A: new evidence goes to a separate branch | product code (`EVIDENCE_PREFIX` in `packages/shared/src/records/merge-gate.ts` and `apps/server/src/services/merge-gate/digest.ts`), the verify prompt in `packages/shared/src/records/verify.ts`, the pr-evidence gate, CI and the feature-map generator all assume `docs/verify/` on the PR branch | rejected: a product change to solve a repository-presentation problem |
| **A': prune `main` weekly** | one script, one ledger file, one generator change | **chosen** |

## Decision

Evidence still lands with its PR under `docs/verify/<ticket>/`, and PR bodies still link SHA-pinned raw URLs. Once a week, `node scripts/evidence-prune.mjs` removes from `main` every evidence folder whose last commit is older than 14 days, in one PR.

- **Add-only within a PR.** A PR still never rewrites another ticket's evidence; `vp.mjs archive` keeps refusing to overwrite a folder. Pruning is the only removal, and only through the weekly PR.
- **Ledger.** `docs/verify/pruned.json` maps each pruned folder to the last commit that held it. `git show <sha>:docs/verify/<ticket>/` reads it back.
- **Feature map.** `scripts/generate-feature-map.mjs` reads the ledger, so a pruned ticket keeps its verification anchor, rendered as `<sha>:docs/verify/<ticket>/`.
- **Kept folders.** A folder that code reads stays, whatever its age: any reference to `docs/verify/<name>` from `apps/`, `packages/`, `scripts/`, `.github/`, `integration/` or `.claude/skills/*/scripts/` keeps it (for example `docs/verify/1542/reach.test.mjs`, which CI runs, and the `docs/verify/920/` manifests a daemon test loads). References from prose (specs, skills changelogs) do not keep a folder; the ledger is how those readers find it.
- **Shallow clones refuse.** In a shallow clone every folder looks freshly committed, so the script exits 2 instead of guessing. The weekly run fetches full history first.
- **Who runs it.** A weekly timer on the maintainer's always-on machine runs the script on a fresh branch from `origin/main`, regenerates the feature map and opens the PR as the cairnwright App with auto-merge, so CI and every gate run on it. A scheduled GitHub workflow cannot do this alone: pull requests opened with `GITHUB_TOKEN` do not trigger CI, and the repository holds no App secret.

First run (this PR): 246 folders pruned, 230 kept; the `docs/verify/` working tree goes from 313M to 141M.

## Consequences

- `.git` does not shrink; history keeps every blob, which is what keeps old PR links alive (ADR 0015 F4 still holds). The gain is the working tree a reader sees and a `--filter=blob:none` clone downloads.
- Prose links to `docs/verify/<ticket>/...` in specs and skills changelogs stop resolving on `main` after 14 days. The ledger and the feature map give the commit to read them from.
- A reviewer of a PR older than 14 days still sees its evidence on the PR branch and in its pinned links.

## Premortem

1. A test or probe starts reading an old folder through a path the grep does not see (built from parts). The test fails red in the prune PR's CI, which blocks the merge; fix by naming the path whole.
2. The weekly routine stops running. Nothing breaks; the tree grows again until someone notices, as under ADR 0015.
3. The ledger is edited by hand and points at a wrong commit. The feature-map anchor then names a commit without that folder; `git show` fails loudly.
