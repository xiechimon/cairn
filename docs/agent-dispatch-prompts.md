# Agent dispatch prompt templates

Append the task, scope and acceptance commands after the matching template; all three executors follow AGENTS.md. Before interpreting a ticket or dispatching work, read its body, comments, linked PRs and relevant specs.

## Starting tasks and reporting (#1556)

Do not start long background tasks directly with `( ... & )`, `nohup`, `setsid` or `disown`: depending on the harness they are either killed when the tool call returns (ledger #1556) or outlive their owner for days. Servers and stacks a step needs run as a background task through `node scripts/owned-process.mjs -- <command>`, which dies with its owner. Agent jobs that must outlive the tool call use `scripts/dispatch-agent.mjs`, which binds them to the agent session and a 12h ceiling:

```sh
node scripts/dispatch-agent.mjs start <id> [--cwd <dir>] [--ticket <ticket> [--force]] -- <full command>
node scripts/dispatch-agent.mjs check <id>
node scripts/dispatch-agent.mjs wait <id> [--timeout-s <n>]
```

start runs the command in its own session (avoiding the process-group cleanup), checks the process immediately and writes the state to a status file (default `$TMPDIR/cairn-dispatch/<id>.json`, overridable with `CAIRN_DISPATCH_STATUS_DIR`; command output goes to `<id>.log`). Before reporting a task's state, run `check` to read the status file; never say "running" from memory. A task started directly has no status record, and `check` reports that the process does not exist. After the job should have finished, run `wait`: it polls until the process exits, then reports the recorded child exit status; a non-zero exit fails the wait.

Dispatch work for a ticket always with `--ticket <ticket>` (ledger: no duplicate check before dispatch, #1569/#1578): start first checks whether someone is already on the same ticket: git working directories whose name contains the ticket number under the system tmp directories (`os.tmpdir()` and `/tmp`, excluding `--cwd` itself), branches on `origin` containing the ticket number, open PRs in `xiechimon/cairn` that mention the ticket number, and codex / pi / grok processes whose command line contains the ticket number. Any hit is listed and start refuses with exit code 1; a source that cannot be checked (for example gh unavailable) is reported as "unchecked", not as no hit. Add `--force` only after confirming the hits are unrelated.

```sh
node scripts/dispatch-agent.mjs start 1556-impl --cwd <worktree> --ticket 1556 -- ai-route run implement -C <worktree> "<task>"
node scripts/dispatch-agent.mjs check 1556-impl
node scripts/dispatch-agent.mjs wait 1556-impl
```

## Lane completion (#2021)

Do not continue on a banned model from the "Do not use" line of the "Model roles" section in `docs/ops/lane-workers.md` (including `deepseek-v4-flash`; `deepseek-v4.1-flash` remains allowed). If `ai-route` selects a banned model, stop and exit non-zero so the dispatcher can retry. If you abort without opening a PR (overlapping work, human decision required, or any other stop), exit the process with a non-zero status.

## Review convergence (#3515)

Add this block to every implementation brief:

```text
Review convergence: for each Codex finding, name its bug class, find every other instance in this PR's diff and the entry paths it touches, and fix them all in one push. Reply on each thread with the class and the sites changed, then resolve it. P0/P1 must be fixed. A real P2/P3 outside this change: open or reuse an issue that tracks it, reply "valid, out of scope for this PR, tracked in #N", resolve the thread. Not a defect: reply with the reason, resolve. Push once per round. After round 3 with findings open, stop and hand the PR to the coordinator with the class list.
Design first: for persisted state, a protocol or concurrency, write a one-page design listing every read and write path and get it reviewed before code.
Ship: follow the Ship steps in AGENTS.md. Push to main without force; if the push is rejected, rebase onto origin/main, re-run the affected checks and push again. Watch CI on your commit and fix it if it goes red. A failing test is not yours only after it fails on origin/main without your change.
Size: one small, self-contained change.
```

## Accessing GitHub

Look up GitHub names, PRs and CI status only with the authenticated `gh api` (`gh api /users/<name>`; 404 means free), one request per name. Do not make unauthenticated batch or looped requests to `github.com/...` pages (curl and browser automation both count). Poll PR / CI status no more often than every 5 minutes. Unauthenticated page requests count against GitHub's secondary rate limit per egress IP, and everyone on the same IP gets blocked together (ledger: GitHub secondary rate limit).

## Image assets

Images for the site, README, demo site, phone UI, icons and avatars, and doc illustrations are generated with codex first, not hand-drawn as SVG or canvas code. Image generation goes to codex whatever the task's implementer is. Show each generated image to the owner first; it goes into the repo and gets pushed only after approval.

## Evidence limits checklist

Apply this checklist before reporting verification or handing off a delivery. For each acceptance claim, record the command, tested commit, app surface (fixture or live), provider mode (stub, real, or not exercised), artifact path, result and remaining limits. Mark an unavailable check as unverified rather than widening a narrower result.

- Fixture screenshots cannot establish real-app behavior. Keep focused fixture UI and visual regression tests; label them as fixture evidence. Verify claims about the real app on an isolated live stack without `?scenario=`, using the relevant API, database or runtime observations alongside screenshots.
- Stub-only runs cannot establish real-provider behavior. Keep deterministic stub regressions, including real-daemon protocol and orchestration checks; name the stubbed boundary and limit the claim to the exercised layers. A real-provider claim requires a real-provider run with recorded provider mode and runtime evidence; if credentials or access are unavailable, report that claim as unverified.
- Make supporting evidence readable: do not commit it to the repository; link or describe it where you report. Embed image links and check that they are reachable.
- Mechanism claims require compiled or runtime evidence of the claimed effect, such as compiled CSS, observed animation state, actual wire payloads, runtime logs or schema snapshots. Source, configuration and installed dependencies alone do not establish that the mechanism took effect. Record the artifact and the assertion it supports.
- Separate automated checks from review: no check judges evidence sufficiency, live-app origin or real-provider execution, so state them yourself and label stub-only runs as such.

## Design rules for UI tasks

A task that touches `apps/web/` gets its rule rows pasted into the brief, not a pointer at the design docs. Run `node scripts/design-rules-for.mjs` on the files the task names (or the directories it will live in) and paste the printed tables under the task text; the lane re-runs the same command when it ends up touching more paths. A task that leaves `apps/web/` prints nothing and needs no block.

```sh
node scripts/design-rules-for.mjs apps/web/src/chief/chief-conversation.tsx apps/web/src/components/chat/
```

## Worker prompt (Codex, Grok, pi)

Implement the task below and verify it according to the repository rules. Apply every item in the [Evidence limits checklist](#evidence-limits-checklist) and report the supported claims and unverified limits. Do not write comments; express intent through naming and code structure; exceptions follow the repository comment discipline. Write all repository content in English: comments, docs, test titles, commit messages and PR bodies. When you make a mistake during the task and fix it, and the same kind of mistake could recur, add a safeguard in the code (type, lint rule, test or CI check) at the highest feasible level, use the real mistake as its negative control, and name the mistake in the PR body. Do not write files under `docs/lessons/`.
