# Live chip popover: the assigned agent's own model line

Bug: the detail chip popover's `执行对话` row (`overlays/chip-popover.tsx`) rendered `AGENT_MODEL_LINE` (`claude-sonnet-5 · 默认`, a fixture capture constant from `apps/web/src/fixtures/core.ts`) on every live todo. An unassigned todo read `未指派 · claude-sonnet-5 · 默认`. An agent on another model still read `claude-sonnet-5`.

Live now: `todo-detail-page.tsx` joins `todo.agent.id` against its existing members query (`useMembers`) and passes `{ modelId, thinkingLevel }` through `DetailHead` to `ChipPopover`. The row reads `<agent> · <modelId> · <thinkingLevel>`, with `默认` (en: `Default`) for a null thinking level. The model segment is absent when the todo is unassigned, members are pending or failed, or the agent has no `modelId`. Fixture mode keeps `AGENT_MODEL_LINE`.

The project head in these shots reads `r3-lifecycle`: that is the separate `PROJECT_NAME` leak fixed in xiechimon/pacman#1419.

## e2e

`apps/web/e2e/live-agent-model-line.spec.ts` boots the live face on stubs (teams, user, todos, members; everything else 500s). Six tests: unassigned, assigned with a thinking level and with a null one (two agents, so a join on the wrong member fails), agent with no model, members held then released, members failed, en locale.

- `e2e-old-code.txt`: the spec against a fixture build of `origin/main` (`e6582946`). 6 failed, each one rendering `claude-sonnet-5 · 默认`.
- `e2e-new-code.txt`: the same spec against this branch. 6 passed.
- `e2e-affected.txt`: `pnpm --filter @pacman/web e2e:affected`, 28 specs, 185 passed.
- `e2e-live-neighbors.txt`: specs outside the affected set that render the popover or the live detail page (`avatar-dicebear`, `review-reject`, `empty-review-closeout`, `composer-paste`, `project-commit-detail`, `attachment-strip`), 44 passed.

## Screenshots

`before/` is `origin/main`, `after/` is this branch, same spec and stubs, captured with `PACMAN_E2E_EVIDENCE`. The before run stops at the first failed assertion, so `before/` has no `assigned-default-level.png`.

- `unassigned.png`: `todo-0`, no agent.
- `assigned-thinking-level.png`: `todo-1`, Beta on `qwen3.8-max`, thinking level `high`.
- `assigned-default-level.png`: `todo-2`, Alpha on `gpt-5.5`, thinking level null.
- `members-pending.png`: `todo-1` with the members read held.

```sh
cd apps/web
PACMAN_E2E_EVIDENCE=docs/verify/live-agent-model-line/after E2E_PORT=<port> pnpm exec playwright test e2e/live-agent-model-line.spec.ts
```

## Fixture mode, byte for byte

`fixture-dom-dump.mjs` records the chip popover's `innerHTML` and the agent row's text on five fixture pages: `/app/todo/r3-legacy-1?scenario=01`, `/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=19` and `?scenario=29` (assigned `r3-builder`), and the unassigned todos `/app/todo/r7-dark-fresh-probe-10?scenario=22d` and `/app/todo/r8-delete-17?scenario=r8-82`. 10 dumps. Run on a `vite build --mode fixture` of `origin/main` (`e6582946`) and of this branch: both files hash to `77ed67e1d96b1cec3f9dddb868258cabc77adb77` (`fixture-dom-diff.txt`). `fixture-dom.json` is the dump. The unassigned fixture todos keep `未指派 · claude-sonnet-5 · 默认`, as before.

```sh
node docs/verify/live-agent-model-line/fixture-dom-dump.mjs http://127.0.0.1:<preview port> /tmp/out.json $PWD/apps/web
```
