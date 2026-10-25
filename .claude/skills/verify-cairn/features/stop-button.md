# Stop button (detail-page composer, #308)

Users interrupt a runaway round on the running task's detail page: the stop button appears in the composer while streaming -> a confirmation popup `停止当前这一轮？` (with `丢弃本轮修改——方案和代码回到上一个版本` checked by default) -> stop -> the transcript's run row transitions through `正在停止…` -> the terminal state `已取消`, and the todo falls back to the gate of the last completed turn (stopping the first-round planning = back to `待开始`, the start button returns). This is the first live surface of the detail page in the map; it needs the full stack (server + web + real daemon + pi), with the stub LLM's gated delayed round providing the stop window.

## Sub-features

- `stop-button-visible` `.composer-stop` renders clickable while streaming (with a claimed/pending step); it does not render on non-running surfaces.
- `stop-confirm-dialog` clicking opens the confirmation popup (the DialogShell 448 family): title + a checkbox row (the components/ui/checkbox primitive, `[role="dialog"] .ui-checkbox input[type="checkbox"]` checked by default, the discard bit; converged at XMON-72; since #951 the `.dlg-accept` row-container class hook retired, the part class taken directly; since #952 the shell-level `.dlg*` aliases retired — the dialog scope goes through `[role="dialog"][aria-label=…]`, the footer through `[data-testid="dialog-foot"]`) + cancel / stop.
- `stopping-transition` after the confirmation, the streaming row's label turns `正在停止…` (a local optimistic state, lasting until the step's terminal state echoes back via the SSE refetch).
- `cancelled-run-row` after the entry lands, the transcript's top run row shows `.chat-stamp-cancelled` `已取消`.
- `gate-fallback` the todo phase falls back: this build has no done step -> prevPhase (a fresh task = todo, the start button returns); with a done step -> its gate (plan done -> confirm, build done -> review). The chip / the primary button migrate automatically with the phase surface.
- `discard-rewind` checking discard = the daemon-side worktree rewinds to the step-start checkpoint (degenerate forms / no-repo tasks skip; the real-repo surface evidence = the daemon unit tests runner-stop + the workspace primitives, this probe does not include the git surface).

## How to get to it (user POV)

- The running task's detail page (`/app/todo/:id`) -> the stop button at the composer's bottom-right (the only entry; no stop surface on the board / chief).
- Driving: this feature has no current case; all registered ones are judged stale and refuse to run without `--force` (the refusal prints the reason), `vp.mjs list stop-button` lists the usage:
  - `vp.mjs drive stop-button stop-chain`: the start button now goes through orchestrate, and the chief round is not dispatched under the stub.

## Driving it with verify-cairn

Preconditions (three more than the other probes — the full stack must be running):

1. `launch.mjs` brings the isolated stack up (server + web), `doctor.mjs` fully PASS.
2. The stub LLM's gated wheel (in the background): `STUB_PORT=8919 node <skill>/scripts/stub-llm-verify.mjs` (the 30s delayed round = the stop window; lsof the port first).
3. Seed + real daemon (curl with SERVER=127.0.0.1:8791, remember `--noproxy '*'`):
   - `GET /api/teams` for the teamId;
   - `POST /api/teams/{t}/providers` `{providerId:"stub-gw",label,baseUrl:"http://127.0.0.1:8919/v1",api:"openai-completions",authHeader:true,compat:{supportsDeveloperRole:false},models:[{id:"stub-model",name:"stub-model"}]}`;
   - `POST /api/teams/{t}/agents` `{displayName:"verify-builder",provider:"stub-gw",modelId:"stub-model"}`;
   - `POST /api/teams/{t}/api-keys` `{name:"daemon-verify",gitAccess:false,mcpAccess:false,toolGrants:{read:[],write:[]}}` -> take the `plaintext`;
   - `POST /api/projects` + `POST /api/projects/{p}/todos` to create the probe task (note the todoId);
   - The daemon (worktree code, scratch home, background): `cd <repo>/apps/daemon && env CAIRN_HOME=/tmp/cairn-stop-daemon-home pnpm exec tsx src/cli.ts start --foreground --server http://127.0.0.1:8791 --api-key <plaintext> --team <teamId> --name verify-mbp`; wait until `GET /api/teams/{t}/machines` shows an `online:true` row.

- **Full chain.** Run `VERIFY_REPO_ROOT=<repo> STOP_DAEMON_HOME=/tmp/cairn-stop-daemon-home node <skill>/scripts/drive-stop.mjs <todoId>` (run from the repo root so @playwright/test resolves). It walks the full chain: the detail page `开始` -> **the #318 unified start dialog (`.overlay-panel`) -> plan-first** -> `.composer-stop` appears (screenshot 01) -> click to open the popup, asserting the default-checked state and the label copy (screenshot 02) -> stop -> `正在停止…` (screenshot 03, the window = abort -> done(stopped) -> SSE refetch, about 0.3-2s) -> `.chat-stamp-cancelled` `已取消` + the start button returns (screenshot 04) -> the three-surface truth: the API (todo phase=todo, build errorMessage=`已取消`, steps contain stopped, a late stop 409s) + SQLite (the step/build/stop_pending zeroing / the todo row) + daemon.log (`stop delivered step=` / `step stopped by user (discard=true)`). Evidence `result.json` 15 checks.
  - The seed must leave the todo in the **`todo` phase** (only creating provider/agent/project/todo + api-key/enroll, **not calling startBuilds**) — otherwise the online daemon claims it into planning within seconds and the `开始` button disappears. drive-stop clicks `开始` itself to trigger the build.
- **Close.** Kill the daemon and the stub (by the pid/task you started, not by name) -> `cleanup.mjs`. Delete the scratch daemon home (/tmp) casually.

## Gotchas

- The daemon is the fourth process, `cleanup.mjs` does not reap it — what you started, you collect; the same for the stub.
- The daemon inherits the shell's proxy env (the `Proxy: http://127.0.0.1:7890` line) — localhost targets usually connect directly, if claims / the stream do not flow, suspect the proxy first. **Unset all 6 proxy env vars** (`HTTP_PROXY HTTPS_PROXY http_proxy https_proxy all_proxy ALL_PROXY` — unsetting only the uppercase or only the lowercase set still leaves the other set blocking; a daemon enroll 401 while a direct curl with the same key returns 200 = the typical proxy symptom).
- **`CAIRN_HOME` pass-through**: with the nested `VAR=val nohup pnpm exec ...` shape, the env may not pass through to the grandchild process, and the daemon falls back to the default `~/.cairn` (the user's real data!). Use `export CAIRN_HOME=...` before nohup, and after startup always check `cat /proc/<pid>/environ | grep CAIRN_HOME` or whether `<home>/machine.json` was newly written.
- **The vite proxy defaults to 8787** (the user's dev port): vite must be started with `CAIRN_DEV_SERVER_PORT=<the verify server port>`, otherwise the browser APIs all 502 -> React does not hydrate -> the page shows zero buttons (the drive script times out looking for `开始`).
- **The stub LLM Node >= v20 close bug**: the old `stub-llm-verify.mjs` cleared the delayed timer with `req.on('close')`, but on Node >= v20 that event fires the moment the request finishes normally (after end) -> the timer is cleared instantly every time -> the stub never answers (the daemon side reports `stream timeout first=300000ms`). Fixed to `res.on('close')` + a `responded` guard; if the stub hangs, check here first.
- The `正在停止…` window is narrow: the drive script waitForSelector's immediately after clicking (4s); on a miss it lands `03-stopping-transition-missed.png` and that check records false (non-fatal, the steady-state evidence remains) — do not chase a missed as a bug.
- Stop only works on an **active step**: clicking again after the step has closed (or POSTing again) = 409 (in the UI the stop button disappears with running, and a 409 after the popup's confirmation silently converges, there is no input to lose).
- Stopping a pending step (not yet claimed by a machine) = the server cancels it instantly, no daemon involved (`{delegated:false}` 200); when a live daemon is running this window is milliseconds, the probe walks the claimed path.
- fish/zsh dialect: use `$(cat file)`, not `()`, for `--api-key $(cat file)` (the Bash tool's zsh dialect errors on a bare `()` as a glob).
- Re-verification = relaunch + re-seed + a new probe task (the api-key/provider idempotency is not guaranteed, do not reuse an old stack).
- **Two `开始` buttons on the fresh detail page** (the banner dhead primary + the main pane `.fresh-start`, measured at XMON-72): `getByRole('button', {name:'开始'})` must collide in strict mode; drive-stop anchors on `.fresh-start`. If a future ticket removes the fresh-block big button, the anchor changes with it.
