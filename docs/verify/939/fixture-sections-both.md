## What

Collapses the PR template to six sections and renames the two the
gate checks; this body is the specimen of the new shape.

## Verified

- [x] `pnpm lint` and `pnpm typecheck` pass
- [x] fixture replay green: docs/verify/939/ -- the pre-change gate
      requires neither of this body's section names, so this body
      fails it; the post-change gate answers 2/2

## Upstream

No equivalent exists: pi has no PR-body surface and claude-agent-sdk
none either; this extends the repo's own scripts/pr-evidence-gate.py
rather than adding a parallel implementation.

## Risk

Two-way door: template, gate, and fixtures move together and revert
together; the blast radius is every body written against the old
section names, which the re-run gate flags until their lanes edit
them.

## Acceptance

Ticket checklist reconciled in the PR body, item by item.

## Issues

Closes #1
