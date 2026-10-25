# Agent detail edit surface

The team page's Agent card is the entry into the agent detail edit surface. The detail surface has three tabs: overview (avatar, name inline edit, role, default skill, model, thinking-level read-only row), memory (entry list + delete), permissions (6 tool switches + team secrets + per-item MCP checkboxes). The create-Agent dialog branches by provider readiness: non-empty candidates = pick provider/modelId directly inside the dialog (no page jump); empty candidates = a `尚未配置模型服务商` warning row + an external configuration link.

## Sub-features

- `card-link` — the team-page agent card (`[data-testid="team-agent-card"]`, the class-name hook retired since #947) is an `<a>`, clicking lands at `/app/resources/agents/<id>`, `?scenario=` travels along.
- `overview-fields` — name (inline edit), role, default skill, model selector; the server record changes after each submits.
- `overview-readonly` — runtime / thinking level are read-only value rows (no buttons): the runtime is derived from the provider slot (that upstream row was a selector, this repo's wire has no independent runtime field, the semantics adjudication is at #499); the thinking-level tier vocabulary reaches the web via the capability read surface `GET /api/capabilities` (XMON-16 / #499 B3 adjudication A), the read-only row presents the tier per that vocabulary — a stored value outside the vocabulary falls back to `默认` (B1 adjudicated "keep read-only": the read surface != the write surface, no selector ships). **The XMON-18 adjudication (2026-10-01) removes the `状态` row** (`agentStatusSchema` has only one value active, zero information; the criterion is "does not exist in the page", not a copy change). In the same adjudication, `创建于 …` is also not done — it **never rendered** (the previous gap was "the DB has no createdAt column"), so it is continued-not-done, not a removed row; `main` will not add this column.
- `memory-tab` — the entry list + delete; the empty-state copy = the shared `MEMORY_EMPTY_COPY` canon.
- `permissions-tab` — the 6 tool switches (copy = shared `AGENT_TOOL_SWITCHES`, **each of the six carries an explanatory sub-copy** = shared `AGENT_TOOL_COPY`), **one aggregated master switch for team secrets** (#510: granularity = the original's all-or-nothing, sub-copy = shared `AGENT_PERMISSION_COPY.secrets`; on = `PATCH { secrets: all team secret ids }`, off = `PATCH { secrets: [] }`, the checked state = `agent.secrets` non-empty; with zero secrets only the empty state `暂无团队密钥。` shows, no switch), per-item MCP checkboxes, landing in `PATCH tools/secrets/mcpServers`.
- `create-model-slot` — the create-dialog model slot's two states; after selection, the `POST /api/teams/{id}/agents` body carries `provider` and `modelId`.
- `delete-agent` — the overview footer `删除 Agent` entry -> the DeleteConfirm-family second confirmation (title/body = the original-language corpus verbatim, `agent_modal.remove_title` / `remove_confirm`) -> after confirm, `DELETE /api/teams/{id}/agents/{aid}` -> lands on the team page. The cancel paths (cancel / X / Esc / backdrop) do not delete and do not jump. The deletion semantics trio (memories do not cascade / `todo.assignment` slot removal / `chief.agentId` binding removal) is in `apps/server/src/services/agents.ts`.

## How to get to it (user POV)

- Team page (`/app/team`) -> click any Agent card -> the detail page.
- The detail-page tab row -> overview / memory / permissions.
- The team-page dashed `创建 Agent` -> the dialog (carrying the model dropdown when providers exist).
- No DP entry: Agents are not in the sidebar resource rows (the original command palette's "go to" list has no Agents row either), the only way in is through the team-page cards.
- Driving: this feature has no current case; all registered ones are judged stale and refuse to run without `--force` (the refusal prints the reason), `vp.mjs list agent-detail` lists the usage:
  - `vp.mjs drive agent-detail edit-and-create`: agent creation without machineId, 400 since ADR 0019.
  - `vp.mjs drive agent-detail identity-chip-link`: agent creation without machineId, 400 since ADR 0019.
  - `vp.mjs drive agent-detail ui-cleanup-finale`: the selectors and geometry it asserts have since changed with subsequent redesigns.

## Driving it with drive-agent-detail.mjs

Preconditions:

- `launch.mjs` brings the isolated stack up (default api 8791 / web 5273, a fresh scratch DB). The script self-seeds: one custom provider (`verify-485-gw` + `claude-sonnet-5`) and one Agent (`verify-485-builder`).
- Run the script itself from the worktree path and carry `VERIFY_REPO_ROOT=<the worktree's absolute path>` (running the main checkout's old script against lane code gives confusing symptoms).

- The team-page card is a link landing on the detail route -> `node <worktree>/.claude/skills/verify-cairn/scripts/drive-agent-detail.mjs` -> `team-card-is-link` (the card element is an `a`) + `card-opens-detail-route` (pathname = `/app/resources/agents/<id>`).
- The overview echo = the server truth -> same command -> `overview-name` / `overview-role-empty-canon` / `overview-model` / `overview-thinking-readonly` (after XMON-18 this also doubles as the "the thinking-level row is still there" gatekeeper).
- The overview no longer shows a `状态` row (XMON-18) -> same command -> `overview-no-status-row` (the `.agent-status` element count is 0). The "does not exist" criterion pins "did not grow back + the removed row left no empty shell" better than a text assertion.
- The thinking-level tiers come from the capability read surface (XMON-16) -> same command -> `capabilities-seven-levels` (the read surface has seven ordered tiers) / `thinking-inside-vocabulary-rendered` (PATCH `high` -> the row shows `high`) / `thinking-outside-vocabulary-falls-back` (PATCH `ultra` -> the row falls back to `默认` with no button). The latter two are the criteria for "the read surface is wired into the UI", verifying only the endpoint does not count; restore the seed state `thinkingLevel: null` after the run.
- Change the name, change the role -> same command -> `name-persisted` / `role-persisted` (re-fetch `GET /api/teams/{id}/agents/{aid}` for the fields, do not read the UI echo).
- Clear the model slot and select it back -> same command -> `model-cleared` (provider/modelId both null) / `model-persisted` (`verify-485-gw/claude-sonnet-5`).
- Permission switches -> same command -> `perm-six-switches` (6 of them) + `tool-persisted` (the server `tools` array).
- The secrets-section aggregated master switch (#510) -> same command -> `secret-row-single` (exactly 1 `.agent-secret-row` row) + `secret-switch-single` (1 switch) + `secret-unchecked-when-empty` (aria-checked=false when unauthorized) + `secret-on-writes-full-id-set` (on -> the server's `secrets` = the full id set fetched via `GET secrets` at click time) + `secret-stays-checked-when-nonempty` (re-fetch truth non-empty -> the checked state holds) + `secret-off-clears` (off -> `secrets` empty).
- The memory empty state -> same command -> `memory-empty-canon`.
- The create dialog selects a model and creates an Agent -> same command -> `create-dialog-model-slot` / `create-dialog-no-warn` / `create-with-model-persisted` (re-fetch the members projection for provider/modelId).
- Delete the Agent -> same command -> `delete-confirm-canon-title` / `delete-confirm-canon-body` (the confirmation-layer copy verbatim) + `delete-cancel-keeps-row` (after cancel, `GET agent` still 200) + `delete-lands-on-team` / `delete-row-gone-404` / `delete-repeat-404` (a repeat delete 404s) + `delete-roster-drops-target` / `delete-roster-keeps-neighbor` / `delete-roster-count-matches-server` (the roster reconciled against the server).

## Gotchas

- **The fixture e2e and the live probe do not substitute for each other**: `apps/web/e2e/agent-detail.spec.ts` + `agent-create-model.spec.ts` run the fixture surface (no backend), proving the interactions and the two states; only this probe can prove persistence. Before this ticket, `patchAgent` was dead code with zero consumption points, and this seam had never been walked from the web surface. The fixture's two scenarios: `agent-detail` (zero secrets -> empty state) and `agent-detail-secrets` (two secrets -> exactly one master-switch row).
- **The first row of the model rows is always the `未设置模型` clear row**: locate the model row by `hasText`, do not use `nth(0)`.
- **The same model id can render two rows**: `toModelOptions` is the union of custom providers and the model-sources non-pi section, `claude-sonnet-5` appears once in providers and once in the claude-code section — assertions must split by the provider slot.
- **Popup screenshots must wait for the entry animation**: `anim-pop` starts at opacity 0, Playwright's visible judgment does not look at opacity, an early shot produces a false image byte-identical to the previous one.
- **PATCH is an invalidateAll refetch (S8)**: after clicking, give ~400ms for the refetch to settle before reading the server, or read the server instead of relying on the UI timing.
- **The delete step is at the script's tail; changing it means changing the asserted Agent name**: step 9 deletes the step-3-renamed `verify-485-renamed` (not the seed name), the `{name}` in the assertion body must follow the `RENAMED` constant; the neighbor `verify-485-created` is built in step 8, so the delete step must come after the create step.
- **The secret seeding deliberately plants two (#510)**: the authorization granularity is all-or-nothing — what is written back is the full set of the team's secret ids. With only one planted, both a "full id set" implementation and a "first id" implementation pass; only two have teeth. The secret `POST` has no idempotency key (a new id each time), so the assertion targets "the server's current id set at click time", secrets left by reruns do not distort the assertion.
