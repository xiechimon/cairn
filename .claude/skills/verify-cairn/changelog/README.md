# changelog — one file per ticket

Change records for verify-pacman. The original form was the "Last updated:" single-line
chain at the top of SKILL.md and features/README.md: every lane stuffed one record at the
chain head, and two lanes appending at once must collide on the same hunk (retired since
#1039). The current form:

- **A lane recording a new entry = create one file**, named `<YYYY-MM-DD>-<ticket or short slug>.md`
  (e.g. `2026-10-08-1025.md`, `2026-09-29-spec12-batch.md`); do not touch the pointer lines in
  SKILL.md / features/README.md, and do not edit other entry files — two lanes recording at the
  same time must not present git with the same hunk.
- Entry content is free-form; make clear: what the ticket added/changed for the skill (custom
  probes, gates, discipline sections), feature-map surface changes, measured pitfalls, and the
  evidence directory (`docs/verify/<ticket>/`). A supplement to the same ticket = edit your own
  file.
- Order and exact time follow `git log --oneline -- .claude/skills/verify-pacman/`; the date in
  the file name is the day the entry was hung, used only for browsing order.

## Section markers in the migrated files

The 2026-10-08 existing files were moved entry by entry from the two old chains: a `## skill`
section = an entry from the original SKILL.md chain, a `## feature map` section = an entry from
the original features/README.md chain, text preserved verbatim (conservation check:
docs/verify/1039/). New entries do not need these section markers, just write free-form.

## Merge recipe for branches that were in flight

For branches cut before this directory landed and still carrying prepend edits to the old
single-line chain: after merging main, move your entry's text into a new file
`changelog/<date>-<ticket>.md`, drop your edits to the old chain lines, and commit — do not
resolve conflicts onto the single-line chain anymore.

## Maintenance

Whole-map and whole-skill maintenance rounds go through `/maintain-verification-skill`.
