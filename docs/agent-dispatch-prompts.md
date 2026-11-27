# Agent dispatch prompt templates

Rules for any agent working on this repository, whichever tool runs it; AGENTS.md applies to all of them. Before interpreting a ticket or dispatching work, read its body, comments, linked PRs and relevant specs.

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
node scripts/dispatch-agent.mjs start 1556-impl --cwd <worktree> --ticket 1556 -- <agent command>
node scripts/dispatch-agent.mjs check 1556-impl
node scripts/dispatch-agent.mjs wait 1556-impl
```

## Lane completion (#2021)

A dispatched run that stops without finishing its task (overlapping work, a decision the owner has to make, or any other stop) exits with a non-zero status: the dispatcher reports the recorded child exit status, and an exit status of 0 after a short wrap-up that did nothing is a bug.

## Accessing GitHub

Look up GitHub names, PRs and CI status only with the authenticated `gh api` (`gh api /users/<name>`; 404 means free), one request per name. Do not make unauthenticated batch or looped requests to `github.com/...` pages (curl and browser automation both count). Poll PR / CI status no more often than every 5 minutes. Unauthenticated page requests count against GitHub's secondary rate limit per egress IP, and everyone on the same IP gets blocked together (ledger: GitHub secondary rate limit).

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

## Plan gate

Follow `docs/ops/plan-gate.md`: small fixes need no plan; features, user-visible behavior changes, new mechanisms, persisted state, wire/step protocols, and concurrency require a `docs/design/<slug>.md` plan reviewed by an independent model (`Reviewer-Model` != `Author-Model`, `Verdict: PASS`, matching `Plan-SHA256`) with `Slice/Status` (`this change` or `later: <ticket or slice>`) on every edge row, real proving tests that exist at the commit and fail on the parent source (`scripts/plan-gate.mjs` + `scripts/regression-inversion-gate.mjs`), and a `Plan: docs/design/<slug>.md` trailer on Tier 1 commits. Code review checks the diff row by row against the plan.

## Worker prompt

Implement the task below and verify it according to the repository rules. Apply every item in the [Evidence limits checklist](#evidence-limits-checklist) and report the supported claims and unverified limits. Do not write comments; express intent through naming and code structure; exceptions follow the repository comment discipline. Write all repository content in English: comments, docs, test titles and commit messages. When you make a mistake during the task and fix it, and the same kind of mistake could recur, add a safeguard in the code (type, lint rule, test or CI check) at the highest feasible level, use the real mistake as its negative control, and name the mistake in the commit message. Do not write files under `docs/lessons/`.
