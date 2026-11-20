---
name: pr-cairn
description: Use only when someone explicitly asks for a pull request in this repo (an outside contributor, or ian asking to see a change before it lands). Normal work ships straight to main by the Ship steps in AGENTS.md; there is no PR-body format, merge queue or evidence gate.
---

# pr-cairn: when a pull request is asked for

Work in this repository ships straight to `main` (`AGENTS.md`, "Ship"). Open a
pull request only when someone asks for one.

When you do:

1. Branch from the latest `origin/main` and run the same checks as Ship step 4.
2. Push the branch without force and open the PR with `gh pr create`, using the
   ordinary `gh` login (`docs/ops/agent-bot-identity.md`).
3. Write a short description: what changed, why, and how you verified it (the
   commands you ran and their results). Name anything you did not verify.
   `.github/PULL_REQUEST_TEMPLATE.md` is an optional outline.
4. Put `Closes #N` on its own line when the PR finishes ticket N.
5. Report the PR URL. Do not merge it yourself unless the person who asked for
   it tells you to.

Screenshots or other evidence go in the description as links or uploads; do not
commit them to the repository.
