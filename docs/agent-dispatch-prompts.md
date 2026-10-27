# Agent dispatch prompt templates

Append the task, scope and acceptance commands after the matching template; all three executors follow AGENTS.md. Before interpreting a ticket or dispatching work, read its body, comments, linked PRs and relevant specs.

## Starting tasks and reporting (#1556)

Do not start long background tasks directly with `( ... & )` or `nohup ... &`: the process-group cleanup when a tool call returns kills them (ledger #1556). Always use `scripts/dispatch-agent.mjs`:

```sh
node scripts/dispatch-agent.mjs start <id> [--cwd <dir>] [--ticket <ticket> [--force]] -- <full command>
node scripts/dispatch-agent.mjs check <id>
```

start runs the command in its own session (avoiding the process-group cleanup), checks the process immediately and writes the state to a status file (default `$TMPDIR/cairn-dispatch/<id>.json`, overridable with `CAIRN_DISPATCH_STATUS_DIR`; command output goes to `<id>.log`). Before reporting a task's state, run `check` to read the status file; never say "running" from memory. A task started directly has no status record, and `check` reports that the process does not exist.

Dispatch work for a ticket always with `--ticket <ticket>` (ledger: no duplicate check before dispatch, #1569/#1578): start first checks whether someone is already on the same ticket: git working directories whose name contains the ticket number under the system tmp directories (`os.tmpdir()` and `/tmp`, excluding `--cwd` itself), branches on `origin` containing the ticket number, open PRs in `xiechimon/cairn` that mention the ticket number, and codex / pi / grok processes whose command line contains the ticket number. Any hit is listed and start refuses with exit code 1; a source that cannot be checked (for example gh unavailable) is reported as "unchecked", not as no hit. Add `--force` only after confirming the hits are unrelated.

```sh
node scripts/dispatch-agent.mjs start 1556-impl --cwd <worktree> --ticket 1556 -- ai-route run implement -C <worktree> "<task>"
node scripts/dispatch-agent.mjs check 1556-impl
```

## Accessing GitHub

Look up GitHub names, PRs and CI status only with the authenticated `gh api` (`gh api /users/<name>`; 404 means free), one request per name. Do not make unauthenticated batch or looped requests to `github.com/...` pages (curl and browser automation both count). Poll PR / CI status no more often than every 5 minutes. Unauthenticated page requests count against GitHub's secondary rate limit per egress IP, and everyone on the same IP gets blocked together (ledger: GitHub secondary rate limit).

## Image assets

Images for the site, README, demo site, phone UI, icons and avatars, and doc illustrations are generated with codex first, not hand-drawn as SVG or canvas code. Image generation is exempt from the "codex for hard jobs only" quota rule. Show each generated image to ian first; it goes into the repo and gets pushed only after he approves.

## Codex

Implement the task below and verify it according to the repository rules. Do not write comments; express intent through naming and code structure; exceptions follow the repository comment discipline. Write all repository content in English: comments, docs, test titles, commit messages and PR bodies. When you make a mistake during the task and fix it, apply the AGENTS.md "Lessons ledger" rule in the same round: add or update an entry file under `docs/lessons/` for the mistake category at the highest feasible protection level, and use the real mistake as the negative control for any new gate.

## Grok

Implement the task below and verify it according to the repository rules. Do not write comments; express intent through naming and code structure; exceptions follow the repository comment discipline. Write all repository content in English: comments, docs, test titles, commit messages and PR bodies. When you make a mistake during the task and fix it, apply the AGENTS.md "Lessons ledger" rule in the same round: add or update an entry file under `docs/lessons/` for the mistake category at the highest feasible protection level, and use the real mistake as the negative control for any new gate.

## pi

Implement the task below and verify it according to the repository rules. Do not write comments; express intent through naming and code structure; exceptions follow the repository comment discipline. Write all repository content in English: comments, docs, test titles, commit messages and PR bodies. When you make a mistake during the task and fix it, apply the AGENTS.md "Lessons ledger" rule in the same round: add or update an entry file under `docs/lessons/` for the mistake category at the highest feasible protection level, and use the real mistake as the negative control for any new gate.
