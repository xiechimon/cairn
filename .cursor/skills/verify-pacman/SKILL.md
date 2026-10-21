---
name: verify-pacman
description: Drive pacman on a scratch stack (Hono 8791, Vite 5273) and prove a user journey with screenshots, console errors, and failed requests. Use when a change needs live UI evidence. Deterministic steps are scripts/glass.mjs. This file is only the flow and the judgment calls.
---

# verify-pacman

Feature map: `features/glass-journeys.md`. That directory is the encyclopedia at `.claude/skills/verify-pacman/features/` (one tree, linked here). Deep `drive-*.mjs` probes stay beside the encyclopedia. This file does not restate their steps.

## Flow

1. Read the journey in `features/glass-journeys.md`.
2. From the repo root, run:

```sh
node .cursor/skills/verify-pacman/scripts/glass.mjs
```

Journey ids, optional: `board`, `create-task`, `dispatch`, `view-diff`, `request-changes`, `merge`. No ids runs all of them. `--out <dir>` sets the evidence directory. The default is `.claude/verify-evidence/<stamp>-glass/`. Cleanup does not delete it, and git does not track it.

3. The command starts Hono and Vite against a scratch `PACMAN_HOME` on ports 8791 and 5273, opens the board, walks the journeys, writes `result.json` and PNGs, then stops only the processes it started.
4. Read `result.json` and the screenshots. For PR evidence, run the journey through the single entry point, `node .claude/skills/verify-pacman/scripts/vp.mjs drive glass-journeys <journey>`, which prints `vp: evidence <dir>`. On the PR branch, archive that directory with `node .claude/skills/verify-pacman/scripts/vp.mjs archive <ticket> --from <dir>`. Archive copies it into `docs/verify/<ticket>/` and refuses to overwrite a directory already there (ADR 0015). Do not copy by hand. After the commit is pushed, `vp.mjs links <ticket>` prints the commit-SHA raw URLs for the PNGs.
5. If 8791 or 5273 is taken, the command exits and names `VERIFY_PORT` / `VERIFY_WEB_PORT`. Leave the listener alone.

## Judgment

The script records facts. These calls are yours:

- Console errors and failed requests are listed, not classified. A Vite transform miss, a favicon 404, or an aborted navigation is not a product failure. A failed `/api/` call during a journey is, unless that journey's expected outcome is the rejection.
- Dispatch: the toast and the chief thread are the handoff. The card remaining in 待开始 with no daemon is the stack boundary, not a failed dispatch. A 409 on `POST /api/todos/:id/orchestrate` that says the chief agent is not bound is a seed miss: the button fired, the bind in the map did not.
- Merge: the toast 已发起合并 means the server accepted the request. The phase staying `review` until a machine runs the merge step is that same boundary, not a failed merge.
- A DOM check can pass while the screenshot shows the wrong pane, an empty diff, or a disabled button. Trust the screenshot, name the stale check, and do not edit the map to make a red run look green.
- Seeded review tasks are a precondition. Create task and dispatch are clicks. A curl is not evidence that the journey worked.
- Use a `drive-*.mjs` probe when the ticket names that probe. Do not re-derive it by hand.
