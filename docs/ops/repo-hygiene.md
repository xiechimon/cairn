# Repo hygiene

Two layers keep every repository surface maintained:

- **Layer A — deterministic.** `.github/workflows/repo-hygiene.yml` runs `scripts/ops/repo-hygiene.mjs` daily (schedule `30 4 * * *`, mode `apply`) and on demand (`workflow_dispatch`, mode `dry` by default, `apply` selectable). Everything it does lands in the job summary. It rewrites one pinned **Repo hygiene report** issue to list the items that need judgement and creates no other issues.
- **Layer B — judgement.** A daily Cairn recurring schedule reads the pinned report and handles what automation may not decide. The owner creates the schedule through the app; the prompt is below.

## What layer A does per surface

- **Pull requests.** Closes a PR only when the paths it changed match main, naming a corresponding main-side commit when known. A matching patch-id alone is insufficient because main may have reverted the change. Drafts and every other open PR are reported, never landed.
- **Issues.** Closes an open issue only when a commit on main names it with a standalone `Closes #N` line, unless someone reopened it or the timeline cannot be verified. Flags issues quiet for over 14 days without closing them for inactivity. Reports open issues that have no destination in `docs/ops/issue-coverage.json` or no label.
- **Branches.** Deletes a remote head only if every patch is on main and its changed paths still match main. A closed PR never overrides that check. Tip commits younger than one day are kept (seven days for `preflight/*`). `main`, `queue/*`, `queue-state/main`, open-PR heads, and heads with a live check run are never deleted. Missing evidence keeps the branch; a deletion is conditional on the remote tip still matching the SHA that was inspected.
- **Project board.** Adds missing open Cairn issues as Todo, moves Cairn issues marked closed to Done, removes drafts whose title matches a real Cairn issue, and reports the remaining drafts. It leaves issues from other repositories alone. Needs `HYGIENE_PROJECT_TOKEN`: a GITHUB_TOKEN cannot write a user-owned Projects v2 board, and fine-grained PATs do not support user projects either, so the step degrades to a report line until the owner stores a classic PAT with the `project` scope as that repo secret.
- **Packages.** Deletes untagged `ghcr.io/xiechimon/cairn-computer` versions and per-sha versions older than 30 days; keeps the newest version, any `latest` tag, and any digest referenced in the repo (e.g. `apps/daemon/computer-image/image.json`).
- **Releases.** Keeps published releases; deletes draft releases older than 24h and their tag only when its commit cannot be reached from any live branch and no other tag points to it. Unreadable tag evidence keeps the draft and its tag. Reports desktop-release runs that failed to publish.
- **Actions.** Deletes caches for deleted branches and closed PRs when the live branch and open-PR lists can be read; leaves tag caches alone. Flags a scheduled workflow whose last 3 runs all failed or that has never run.
- **Docs.** `scripts/doc-refs-gate.mjs` checks markdown links, anchors and repo paths named in living docs (archive/changelog/research/verify/lessons snapshots and generated files are excluded by design). It runs in `pnpm prepush`, so a change that breaks a doc reference fails at preflight; `scripts/doc-refs-baseline.json` holds the pre-existing backlog and `--write-baseline` shrinks it as fixes land. The full stale list goes into the report for layer B.
- **Security.** Reports every open Dependabot, CodeQL and secret-scanning alert, and drifts: alerts disabled, automated security fixes enabled (policy: off — bumps stay owner-gated through queue/main), CodeQL default setup missing, secret scanning off.
- **Settings drift.** Wiki re-enabled, Discussions templates missing, `green-main` ruleset weakened — all reported.

## Layer B: the Cairn recurring schedule

Create a schedule that runs once a day, with this prompt verbatim:

```text
Read the pinned issue "Repo hygiene report" in xiechimon/cairn and handle every
judgement item it lists:

- Pull requests marked "still wanted?": read each PR's diff, decide whether its
  remaining change is still wanted. If a lane should land it, route it through
  queue/main like any other work (rebase onto origin/main, preflight green,
  push-queue). If it is dead, close it with a comment saying why. Do not merge
  through the PR UI.
- Branches holding unique commits: judge whether the work is already covered on
  main or is a lane's unlanded progress; either open the work as an issue/PR or
  name the branch for deletion in the report.
- Board drafts: convert the ones that are real work items into issues (link them
  to an epic manifest or docs/ops/issue-coverage.json destination) and remove the
  rest from the board.
- Issues quiet for over 14 days, unlabeled issues, and issues with no
  destination: triage them per the issue policy (destination entry, labels, or
  close with a reason). Never close a stale issue just for being quiet.
- Doc references the report lists as broken: fix the doc or delete the section;
  when docs contradict the code, the code wins — update the doc, and shrink
  scripts/doc-refs-baseline.json with `node scripts/doc-refs-gate.mjs
  --write-baseline`. The README hero screenshot still shows an iPhone; reshoot it
  on a live stack (scripts/capture-readme-screenshots.mjs) when the current home
  design is the one to keep.
- Security alerts marked open: confirm each on its surface. Fixes on security
  surfaces go through /security-review in a subagent before landing.
- A desktop-release run that failed to publish: diagnose and, when the failure is
  in-repo, fix it as an ordinary change.

Commit fixes as xiechimon, land them through scripts/ops/push-queue.mjs, and
reply in the report issue with what was handled when the run changes anything.
```

## Running it by hand

```sh
node scripts/ops/repo-hygiene.mjs --mode dry      # plan only, no mutations
node scripts/ops/repo-hygiene.mjs --mode apply    # perform the mutations + update the report issue
```

`--no-report` skips the issue update in apply mode. The board section needs
`HYGIENE_PROJECT_TOKEN`; the rest runs on `GH_TOKEN`/`gh` login alone.

Tests: `node --test scripts/ops/repo-hygiene.test.mjs scripts/doc-refs-gate.test.mjs`.
