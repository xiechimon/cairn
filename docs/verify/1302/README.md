# 1302 thinking level dropdown

Live stack: web `http://127.0.0.1:5273`, server `http://127.0.0.1:8791`, fresh `PACMAN_HOME` under `.claude/verify-run/home`. Agent `8McoEUwv_ryxkBnhcfnfg`, provider null (pi).

Before the change, the row is a `span.agent-thinking` with text 默认. It has no button. Clicking it sends no PATCH. See `before-overview.png`, `before-dom.json`, `before-agent.json`.

After the change, the row is `.agent-thinking-select`. The closed control reads 未设置 (`after-closed.png`). The menu lists 未设置 plus off, minimal, low, medium, high, xhigh, max (`after-open.png`). Choosing high sends `PATCH {"thinkingLevel":"high"}`. The trigger, `GET /api/teams/.../agents/...`, and the SQLite `agent.thinkingLevel` column all read `high`, including after reload (`after-picked.png`, `after-reload.png`, `after.json`).

The e2e specs in `apps/web/e2e/agent-detail.spec.ts` cover the PATCH body, the claude-code menu (off, no minimal), and clearing `minimal` when the runtime switches to claude-code. `e2e-fail.txt` is the run before the fix. `e2e-pass.txt` is the run after.
