---
name: retro-cairn
description: Use when wrapping up a task or after fixing an error: list the mistakes that appeared and got fixed along the way (including ones a user corrected), attribute them, turn them into recurrence-preventing safeguards, and record them in docs/lessons.md.
---

# retro-cairn: process error -> safeguard

This repo's canonical name is `retro-cairn`, not `retro`: a personal-level skill of the same name takes precedence over a project-level one, so the repo cannot take over the name `retro` (the same reason as `pr-cairn`). After switching accounts or machines, cloning this repo makes it available without depending on personal skills.

Principle: a mistake that appeared during the process, even if fixed by the end, must be surfaced so the same kind gets stopped automatically next time. This applies to mistakes an agent makes itself and to mistakes made by the systems under management.

## When to trigger

- Before wrapping up a thread or task and preparing the report (no user reminder needed).
- After a test goes red then green, several rounds of CI fixes, a review rejection, a plan being turned down, a retry, a rollback, or being corrected by a user.

## Steps

1. List the errors: list every "appeared and got fixed" point, one sentence describing the symptom. Ones a user corrected always count.
2. Attribute: ask "why was it not stopped at the time", find the root cause (missing check, unclear rule, missing context, tool misuse).
3. Choose a safeguard, working from level 1 downward asking "can this be done"; the ledger's five-rung ladder is the canonical source (`docs/lessons.md`): architecture or types > lint, script gates, tests, CI > rules > skills > memory. Levels 4 and 5 must note in the remark why a higher level cannot be done; if it cannot be done now, open a ticket and put the ticket number in the remark, do not write just "to be upgraded" (`node scripts/lessons-ledger-gate.mjs` checks this). A new machine check must use this real mistake as the negative control: the old error turning red under the new gate is what counts as landing it.
4. Record: add a row to the `docs/lessons.md` ledger. One error kind per row, merge the same kind, do not open duplicate rows.
5. Recurrence escalation: when the same kind appears again, increment "recurrences" and push the safeguard to a harder level, not add another line of text.
6. Report: when wrapping up, summarize in one or two sentences how many process errors were caught and what safeguard each became.

## Boundaries

- Ask the user first before a safeguard that touches ADRs, protected paths, or changes intended behavior.
- Safeguards go through the normal PR flow (open PR, open auto-merge, wrap up), not around review.
- Do not aim for "never again"; aim for "every mistake has a home, is countable, and escalates".