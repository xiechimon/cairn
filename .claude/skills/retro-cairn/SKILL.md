---
name: retro-cairn
description: Use when wrapping up a task or after fixing an error: list the mistakes that appeared and got fixed along the way (including ones a user corrected), attribute them, turn them into recurrence-preventing safeguards, and record them as an entry file under docs/lessons/.
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
3. Choose a safeguard: prefer architecture or types, then lint or tests, then instructions or skills. Use the real mistake as a negative control for a new machine check.
4. Record: create or update `docs/lessons/<ticket>-<short-name>.md`, one file per kind of mistake. Write freely about the cause and safeguard; follow `docs/lessons/README.md`.
5. Recurrence: update the existing document and strengthen the safeguard when the same kind of mistake appears again.
6. Report: when wrapping up, summarize in one or two sentences how many process errors were caught and what safeguard each became.

## Boundaries

- Ask the user first before a safeguard that touches ADRs, protected paths, or changes intended behavior.
- Safeguards go through the normal PR flow (open PR; arm its merge only when pr-gate returns go with `mergedBy: 'auto-merge'`, otherwise it goes to ian; wrap up), not around review.
- Do not aim for "never again"; aim for "every mistake has a home and a useful safeguard".
