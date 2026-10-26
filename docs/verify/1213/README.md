# #1213 dual execution sources (ADR 0017) live acceptance evidence

probe: `drive-1213-dual-source.mjs` (verify-pacman custom probe; stack = launch.mjs isolated instance, server 8791 + web 5273 + an isolated PACMAN_HOME; two real daemons + a self-recycling stub LLM). Result: **15/15 checks PASS** (`result.json`).

## Scenario

Ground-truth remote = the public repo `octocat/Hello-World` (cloneUrl derived as `https://github.com/octocat/Hello-World.git`, anonymous clone/fetch). The local accelerator-slot seed = a real clone of that repo with the `master` ref deliberately rewound to the old commit `553c207` (ground-truth tip = `7fd1a60`) — the live evidence for the freshness judgment: when the local source lags, the materialized worktree must still land on the remote tip.

| leg | action | criterion (evidence files) |
|---|---|---|
| server unbinding | POST github project (no localPath) → PATCH attach accelerator slot → SQLite row | `patch-localpath.json` / `sqlite-project-row-localpath.json`: githubRepo and localPath coexist; the server validates only the absolute-path shape, not existence (the path lives on the executor machine) |
| web minimal face | settings page (browser real-user path) shows the server ground truth → change and save → PATCH persisted | `settings-field-before.png` / `settings-field-after.png` / `project-record-after-ui.json` |
| daemon A (machine where the accelerator slot is visible) | build 1 claimed → workspace materialized | `daemon-a-source-log.txt`: `[workspace] Repo source: local-path <path>`; `daemon-a-repo-state.json`: the base's origin re-pointed at the ground-truth URL; the conv worktree HEAD = `7fd1a60` (fetched to the remote tip, not the local old sha `553c207`) |
| localPath disqualification | PATCH localPath → a nonexistent path (the ticket's action) | `sqlite-project-row-badpath.json` |
| daemon B (disqualified machine, base absent) | build 2 claimed → silent fallback | `daemon-b-source-log.txt`: `[workspace] Repo source: github-clone (local-path <path> not found)`; `daemon-b-repo-state.json`: the base = a real GitHub clone, worktree HEAD = `7fd1a60` |

Both legs' build steps end `failed` (stub LLM zero changes → artifact-gate red) as expected — the materialization seam sits before the session; this ticket's acceptance face = the source-selection logs + the git artifacts, independent of step success.

## Rerun recipe

```sh
node .claude/skills/verify-pacman/scripts/launch.mjs          # start the isolated stack
node .claude/skills/verify-pacman/scripts/drive-1213-dual-source.mjs
node .claude/skills/verify-pacman/scripts/cleanup.mjs
```

Needs real GitHub network (anonymous-reachable clone/fetch). The two daemons each hold their own api-key (#895 gotcha); after killing A, wait 80s to pass the zombie-claim window before dispatching build 2 (#1025 gotcha) — built into the script.

## Unit / e2e faces

- server: `apps/server/test/project-dual-source.test.ts` 14/14 (POST/PATCH/claim payload three faces) + the existing 60 regressions all green.
- daemon: `apps/daemon/test/workspace-source.test.ts` 8/8 (normalization, dual-condition three states, TOCTOU fallback, default-branch re-pin, zero drift).
- web: `apps/web/e2e/project-settings-local-path.spec.ts` 2/2 (live-stub pins the wire body: saving posts `{localPath:'<path>'}`, clearing sends the explicit key `"localPath":null`, hosted shows nothing); the full affected e2e run green at 917.
