---
name: pr-pacman
description: Use when writing a PR body for this repo. Carries the pacman PR body contract (six sections from .github/PULL_REQUEST_TEMPLATE.md, checked by the pr-evidence CI gate) and replaces the global show-me template (Summary/Evidence/Merge Danger), which fails the gate here.
---

# pr-pacman — writing a PR body in pacman

The body is a hard contract, not a style suggestion: the `pr-evidence` CI gate
checks the section names and the links. The global `pr` skill (Humanlayer
show-me: `## Summary` / `## Evidence` / `## Merge
Danger`) does not pass this repo's gate — four lanes in one day each followed
it, failed, and hand-rewrote the body (#1100, #1103, #1105, #1111; issue
#1110). When writing a PR body in this repo, follow this skill; do not use
the global template even if it also matches.

## Write it plainly

The body is read by someone who did not watch the work. Apply the `unslop`
rules to it, and write like a person reporting what they did.

- No em dashes. Use a period or a comma. Rule 13.
- No AI vocabulary: crucial, delve, robust, seamless, leverage, showcase,
  landscape, testament, tapestry. Use the plain word. Rules 7 and 31.
- No "not just X, but Y", no rule of three, no synonym cycling. Rules 9, 10, 11.
- No bold label followed by a restatement of the label. Write the sentence. Rule 16.
- No chatbot lines, no closing pleasantries. Rules 20, 22.
- No metaphor nouns: substrate, surface, harness, ratchet, primitive, north
  star. Name the thing. Rule 26.
- Sentence case headings. Straight quotes. Rules 17, 19.
- One idea per sentence. If a sentence needs a second read, split it. Rule 28.
- Say what the change does, not how it feels. A number or a symbol beats an
  adjective. Rules 27 and 30.
- Describe the current state only. Do not write that something was removed,
  retired, dropped, or "used to be" something else; the reader never saw the
  old version, so the note is noise. Delete the thing and say what stands now.

The same rules apply to ticket bodies, commit messages, code comments and
lane briefs.

## The six sections (exact headings)

### `## What`

What this PR does and why, plus the ticket it answers. Prose. Say what
changed and what it replaces or fixes; name files and symbols instead of
describing them.

Screenshots belong here when the change is visible in the running app: commit
them under `docs/verify/<ticket>/` and embed them with a SHA-pinned raw URL
(the repo is public, raw is anonymously readable):

```markdown
![label](https://raw.githubusercontent.com/xiechimon/pacman/<sha>/docs/verify/<ticket>/shot.png)
```

The SHA must already be on the remote, so commit and push the branch first,
then write the body.

### `## Verified`

Both halves pasted verbatim, not narrated: the command run on the old code
(its actual failing output) and the same command on this change (its passing
output — `pnpm lint` / `pnpm typecheck` / affected e2e results go here). A
claim that "without this change X would fail" is not evidence. HTML comments
do not count as an answer (the gate strips them).

### `## Upstream`

Does an equivalent exist in the current dependencies (pi / claude-agent-sdk /
code already in this repo)? If an equivalent was rejected, give the checkable
reason (security boundary, different data source, different interaction
semantics); "more controllable" or "fits our model better" do not qualify. If
the PR adds no mechanism, say so in one line. HTML comments do not count.

### `## Risk`

One-way or two-way door? Blast radius: what else this change can touch, and
which runs ruled that out (name the runs).

### `## Acceptance`

If the ticket carries an acceptance checklist, reconcile it item by item,
each item pointing at its evidence. If the ticket has no checklist, write
exactly that in one line.

### `## Issues`

`Closes #N`. The squash commit body is what actually closes the ticket —
carry the closing keyword in the branch commit message too (PR bodies do not
enter the squashed commit). If this PR is one segment of a multi-segment
ticket, state which segment closes the ticket and that the squash body must
not carry the closing keyword for the parent ticket.

## Mechanics

- Write the body to a temp file; never inline multi-line markdown as
  `--body`.
- Create from a worktree lane:
  `gh pr create --repo xiechimon/pacman --head xiechimon:<branch> --body-file /tmp/pr.md`.
- Run the gate locally before opening:
  `python3 scripts/pr-evidence-gate.py /tmp/pr.md` — exit 1 names each
  problem (`missing-section` / `empty-section` / `not-embedded` /
  `unreachable`).
- Editing an open PR: `gh pr edit` breaks on Projects-classic GraphQL
  errors; use `gh api -X PATCH repos/xiechimon/pacman/pulls/<n> -F
  body=@/tmp/pr.md`, then re-read with `gh pr view <n> --json body` and
  compare.
- Image links must be the embedded `![label](url)` form and must not sit
  inside fenced code blocks — a link in a fence renders nowhere.
- Bodies are in English.

## Gate facts — what is actually enforced

| requirement | enforced by |
|---|---|
| `## Verified`, `## Upstream` answered (non-empty after stripping comments) | pr-evidence (required check) |
| image links embedded + HTTP 200 | pr-evidence (required check) |
