# #939/#940/#1079 evidence: PR body gate widening

One gate (`scripts/pr-evidence-gate.py`, CI job `pr-evidence`), four
tickets:

- **#939** — the PR template gains two answer-checked sections (the
  reviewer judges quality; the gate only checks that an answer exists).
  Guidance ships as HTML comments, and comments never count as an
  answer, so an untouched template fails. The two original section
  names were later collapsed by #1079 (below).
- **#940** — the image-link criteria widen from "raw.githubusercontent.com
  image extensions" to two parallel rules: (1) an image extension
  (`png|gif|jpe?g|webp|svg`) on **any** host; (2) an **extensionless** URL
  on a media-only host (`user-images.githubusercontent.com`,
  `github.com/user-attachments`) — the shape drag-and-drop uploads produce.
  Fenced code blocks still do not exempt image links (settled non-goal).
- **#1079** — the template collapses to six sections (What / Verified /
  Upstream / Risk / Acceptance / Issues). The two gate-checked sections
  are renamed and merged: the verification question and the
  failure-path question become one **Verified** section that asks for
  the red-then-green output pair; the upstream question keeps its
  heading, shortened to **Upstream**. Risk and Acceptance are new
  non-gate sections (Acceptance is conditional on the ticket carrying a
  checklist). What must embed one explanatory diagram (`.drawio.svg`).
  `REQUIRED_SECTIONS` becomes `('Upstream', 'Verified')`; the gate's
  mechanics are unchanged — it still checks answered-or-not, and it
  still cannot judge the red/green pair, the diagram's explanatory
  value, or an Acceptance reconciliation (all reviewer judgments). The
  fixtures and recordings in this directory were re-shaped and
  re-recorded against that gate; the verdict columns below read the
  same as before because the collapse preserves every failure mode.
- **#1335** — the gate learns a third embedded form: a URL inside an
  HTML `<img src="...">` attribute or a `<source srcset="...">`
  attribute. The Cursor badge footer the agent injects after
  `<!-- CURSOR_AGENT_PR_BODY_END -->` is two `<picture>` blocks, each
  with two `<source>` variants and an `<img>` fallback; without #1335
  the gate red-flags every badge URL as a bare external image link
  even though GitHub renders the badge. The footer is injected by the
  agent, so a lane cannot strip it; the gate has to recognize the
  form. Bare URLs that are not wrapped in any of the three forms still
  fail -- the fix is not a free pass for forgotten image links
  (`fixture-html-control-bare.md`). The previously-recorded
  `fixture-img-tag-dragdrop.md` output was re-recorded against the
  fixed gate: the `<img src>` URL is now embedded (one fewer
  not-embedded line) but still fails on reachability (the asset UUID
  returns 404).

Everything below was recorded before the PR was opened: fixtures and
expected verdicts first, then the implementation, then re-runs
(`pre-change-runs.txt` pins the old gate missing every new case).

## Failure modes enumerated up front

Link criteria:

1. image-extension URL on a non-raw host, bare → old gate blind, must RED;
2. same as `[label](url)` link → must RED;
3. same embedded and reachable → must GREEN;
4. raw `.svg` (extension the old gate did not scan) → must be scanned;
5. extensionless `user-attachments` upload URL → must RED;
6. `user-images` host URL → must RED when not embedded;
7. drag-and-drop `<img src="...">` HTML and inline-code-spanning: URL
   boundary characters (`"`, backtick) must not leak into the matched URL;
8. raw non-image references (`.json`, `.md`, `.txt`, `.sh`, `.log`,
   extensionless `LICENSE`, directory permalinks ending `/`) → must stay
   ignored (#750 scope note stands);
9. bare image URL inside a fenced code block → must stay RED (non-goal);
10. reachability probe (plain curl, HTTP 200) and finding format
    (`[label](url)`, or `url (bare URL, line N)`) → unchanged.

Section check:

11. both sections missing → RED naming both;
12. one missing → RED naming that one;
13. heading present, only HTML comments beneath → RED as empty;
14. headings only inside a fenced quote of the template → RED (a quoted
    template is not an answer);
15. both answered → GREEN regardless of the rest;
16. merged PRs never re-run the gate, so history is untouched (the CI
    trigger is per-PR `opened/edited/synchronize/reopened`).

## Fixture table

`fixture-*.md` are input bodies; `gate-*.txt` are stdout + `exit=N` of
`python3 scripts/pr-evidence-gate.py <fixture>` with the new gate;
`pre-change-runs.txt` is the same sweep through the gate pinned at
`da84ed9c` (pre-change main tip). The link-criteria fixtures carry
answered sections on purpose, so their verdicts isolate the link rules.
After #1079, `sections-missing` is shaped like the /pr skill's output
(Summary / Evidence / Merge Danger) — the second template the #1079
background describes — so the fixture pins the realistic post-merge
failure: a body from either the old template shape or the /pr shape
answers neither required section.

| fixture | pins | old gate | new gate |
|---|---|---|---|
| `raw-svg-embedded` | rule 1 scans `.svg` on raw | GREEN, scanned 0 | GREEN, scanned 1 |
| `ext-anyhost-bare` | rule 1, any host, bare | GREEN, scanned 0 | RED: not-embedded + unreachable 404 |
| `ext-anyhost-embedded` | rule 1 green path (shields.io svg, 200) | GREEN, scanned 0 | GREEN, scanned 1 |
| `user-attachments-bare` | rule 2, extensionless upload URL | GREEN, scanned 0 | RED: not-embedded + unreachable 404 |
| `user-images-link` | rule 1 catches `[label](url)` on any host | GREEN, scanned 0 | RED: not-embedded + unreachable 403 |
| `img-tag-dragdrop` | `<img src>` form + code span; no `"`/backtick leakage in named URLs | GREEN, scanned 0 | RED (3), URLs clean — `<img src>` embedded (#1335), one not-embedded line dropped |
| `html-img-embedded` | `<img src="...">` alone is embedded (#1335) | GREEN, scanned 0 | GREEN, scanned 1 |
| `html-source-srcset-embedded` | `<source srcset="...">` URLs are embedded (#1335) | GREEN, scanned 0 | GREEN, scanned 3 |
| `html-cursor-badge` | the Cursor badge footer is all embedded (#1335) | GREEN, scanned 0 | GREEN, scanned 6 |
| `html-control-bare` | bare URL outside the three forms still RED (#1335) | GREEN, scanned 0 | RED: not-embedded + unreachable 404 |
| `raw-refs-green` | mode 8: references stay ignored | GREEN, scanned 0 | GREEN, scanned 0 |
| `codeblock-bare` | mode 9: fences do not exempt | RED (1) | RED (1), byte-identical link verdict |
| `sections-both` | mode 15 | GREEN | GREEN |
| `sections-missing` | mode 11 | GREEN | RED (2), both named |
| `sections-empty` | mode 13 | GREEN | RED (2), `empty-section` |
| `sections-one` | mode 12 | GREEN | RED (1), names the missing one |
| `sections-fenced` | mode 14 | GREEN | RED (2), `missing-section` |
| (template file) | untouched template must fail | GREEN | RED (2), `empty-section` — `gate-template-untouched.txt` |

## How the link criteria were decided (measure first)

`merged-25-measurement.md` (+ `measure-host-rules.json`, produced by
`measure-host-rules.py`) replays the 25 most recently merged PR bodies
through three criteria:

- **old** (pinned gate): baseline scan/red counts.
- **literal** reading of #940 (rule 2 = *any* URL on the three known
  image hosts, raw included): **+79 newly scanned links in 11 of 25
  bodies, every one a not-embedded RED** — classes: `.md` ×24, `.txt`
  ×27, `.json` ×21, `.log` ×3, `.mjs` ×1, `.sh` ×1 (77 non-image
  evidence references that cannot be embedded as images at all),
  1 directory permalink, 1 backtick-suffixed directory URL. **0 true
  violations, 79 false positives** → rejected.
- **final** (shipped): rule 2 restricted to media-only hosts and
  extensionless last segments; raw is judged by rule 1 alone.
  **+0 newly scanned, +0 red, 0 false positives**; per-PR scan counts
  identical to old in all 25 bodies (no regression). The corpus contains
  no `user-images`/`user-attachments`/off-host image URLs at all — the
  bypass #940 closes was latent, so the true-positive side is pinned by
  fixtures instead (that split is exactly what the ticket asked each
  side to prove).

0 open PRs existed at fetch time (no in-flight lane is hit at merge);
0 of 25 bodies answer the two #939 sections (expected — the template is
new). After merge, any PR that is edited or pushed to needs the two
sections in its body; after #1079 merges, the same applies under the
new names — bodies written against the pre-#1079 template or the /pr
skill shape answer neither required section and fail the renamed check
until their lanes edit them. `pr-evidence` is not a branch-protection
required check, so a red there blocks nothing, but lanes should fix
their bodies to keep the signal clean.

Two measured facts about `github.com/user-attachments` worth knowing
(they do not change the criteria — #940 names this host as a bypass to
close, and repo policy wants evidence committed to the branch anyway):

- a live asset URL answers **302** (redirect to the JWT-signed CDN) to
  the gate's plain `curl`, so even a properly embedded attachment fails
  the unchanged HTTP-200 probe;
- GitHub's current editor inserts drag-and-dropped images as
  `<img src="...user-attachments...">` HTML, which renders — the gate
  recognizes the form as embedded after #1335, but the 302 above still
  red-flags the body on reachability (`fixture-img-tag-dragdrop`
  re-recorded with one fewer FAIL line).

So a drag-and-drop attachment can still never pass this gate by
construction; the passing form is a committed file under
`docs/verify/<ticket>/` with a raw permalink, embedded as
`![label](url)`.

## #750 fixtures under the new gate

`replay-750.txt`: every `docs/verify/750/fixture-*.md` re-run through
the widened gate. All image-link findings are line-for-line identical to
the recordings in `docs/verify/750/gate-*.txt`; each body additionally
fails the two required sections (those fixtures predate the template).
The #750 README's scope note ("only raw.githubusercontent.com image
links are checked") is superseded by this directory. The file is a
historical recording of the pre-#1079 gate and is kept as an archive:
its FAIL lines name the pre-#1079 sections, and #1079 did not touch the
link criteria, so the image-link findings would reproduce identically
today while the section lines would carry the new names.

## Re-running

```sh
python3 docs/verify/939/replay.py            # compare with recordings
python3 docs/verify/939/replay.py --write    # re-record (refuses HTTP 000)
python3 docs/verify/939/measure-host-rules.py --json out.json
```

Reachability lines depend on live egress to the probed hosts. The
recording workstation's GitHub egress flapped intermittently while this
evidence was captured (curl `000` = could not reach at all); `replay.py
--write` refuses to record a run containing `000`, so every recorded
verdict here comes from a fully clean pass (recorded 2026-10-07/08 UTC,
lane workstation). False-positive classification in the measurement is
form-driven and does not depend on those probes. CI runs the gate on
GitHub runners, whose egress is not affected.
