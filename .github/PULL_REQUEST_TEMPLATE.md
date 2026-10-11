## What

<!-- What this PR does and why, plus the ticket it answers. Prose: name the
files and symbols that changed and what they replace or fix. Screenshots
belong here when the change is visible in the running app; commit them under
docs/verify/<ticket>/ and embed them as ![label](raw-url) with a SHA-pinned
raw URL. -->

## Verified

<!-- Required; the pr-evidence CI gate checks that this section carries
answer text (HTML comments do not count as an answer, so deleting or
keeping only this comment fails the build). The gate checks that you
answered, not how well; the reviewer judges the answer.
Both halves, pasted, not narrated: the command run on the old code
(the actual failing output, or an --expect=old leg) and the same
command on this change (the passing output; for code changes this is
where pnpm lint / typecheck / relevant e2e results go). A claim that
"without this change X would fail" is not evidence. -->

## Upstream

<!-- Required; the pr-evidence CI gate checks that this section carries
answer text (HTML comments do not count as an answer, so deleting or
keeping only this comment fails the build). The gate checks that you
answered, not how well; the reviewer judges the answer.
If this PR adds a mechanism: does an equivalent exist in the current
dependencies (pi / claude-agent-sdk / code already in this repo)? If an
equivalent was rejected, give the checkable reason (security boundary,
different data source, different interaction semantics); "more
controllable" or "fits our model better" do not qualify. If the PR adds
no mechanism, say so in one line. -->

## Risk

<!-- One-way or two-way door? Blast radius: what else this change can
touch, and what was run to rule that out (name the runs). -->

## Acceptance

<!-- Conditional. If the ticket carries an acceptance checklist,
reconcile it item by item, each item pointing at its evidence. If the
ticket has no checklist, write exactly that in one line. Not
gate-checked: whether a ticket has acceptance items is a property of
the ticket, and a hard check here would force performative paragraphs. -->

## Issues

Closes #N
