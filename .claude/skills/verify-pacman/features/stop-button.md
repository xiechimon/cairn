# 停止钮(详情页 composer,#308)

用户在运行中的任务详情页中断失控的一轮:streaming 时 composer 出现停止钮 → 确认弹层「停止当前这一轮？」(默认勾选「丢弃本轮修改——方案和代码回到上一个版本」)→ 停止 → transcript 运行行「正在停止…」过渡 → 终态「已取消」,todo 回落上一完成 turn 的 gate(首轮规划被停 = 回「待开始」,开始钮回位)。这是详情页第一个入图的 live 面;需要全栈(server + web + 真 daemon + pi),stub LLM 门控延迟轮提供停止窗口。

## Sub-features

- `stop-button-visible` streaming(有 claimed/pending 步)时 `.composer-stop` 渲染可点;非运行面不渲染。
- `stop-confirm-dialog` 点击开确认弹层(DialogShell 448 族):标题 + 复选行(components/ui/checkbox 原语,`[role="dialog"] .ui-checkbox input[type="checkbox"]` 默认勾选,discard 位;XMON-72 收口;#951 起 `.dlg-accept` 行容器类钩退役,件类直取;#952 起壳级 `.dlg*` 别名退役——dialog scope 走 `[role="dialog"][aria-label=…]`,底栏走 `[data-testid="dialog-foot"]`)+ 取消/停止。
- `stopping-transition` 确认后 streaming 行标签转「正在停止…」(本地乐观态,持续到步终态经 SSE 重取回显)。
- `cancelled-run-row` 落账后 transcript 顶部运行行出现 `.chat-stamp-cancelled`「已取消」。
- `gate-fallback` todo phase 回落:本 build 无 done 步 → prevPhase(fresh 任务 = todo,开始钮回位);有 done 步 → 其 gate(plan done → confirm,build done → review)。chip/主按钮随 phase 面自动迁移。
- `discard-rewind` 勾选丢弃 = daemon 侧 worktree rewind 到步起点 checkpoint(退化形/无 repo 任务跳过;真 repo 面证据 = daemon 单测 runner-stop + workspace 原语,本 probe 不含 git 面)。

## How to get to it (user POV)

- 任务详情页(`/app/todo/:id`)运行中 → composer 右下停止钮(唯一入口;看板/总管无停止面)。

## Driving it with verify-pacman

Preconditions(比其余 probe 多三件——全栈在跑):

1. `launch.mjs` 起隔离栈(server + web),`doctor.mjs` 全 PASS。
2. stub LLM 门控轮(后台):`STUB_PORT=8919 node <skill>/scripts/stub-llm-verify.mjs`(30s 延迟轮 = 停止窗口;端口先 lsof)。
3. seed + 真 daemon(curl 走 SERVER=127.0.0.1:8791,记得 `--noproxy '*'`):
   - `GET /api/teams` 取 teamId;
   - `POST /api/teams/{t}/providers` `{providerId:"stub-gw",label,baseUrl:"http://127.0.0.1:8919/v1",api:"openai-completions",authHeader:true,compat:{supportsDeveloperRole:false},models:[{id:"stub-model",name:"stub-model"}]}`;
   - `POST /api/teams/{t}/agents` `{displayName:"verify-builder",provider:"stub-gw",modelId:"stub-model"}`;
   - `POST /api/teams/{t}/api-keys` `{name:"daemon-verify",gitAccess:false,mcpAccess:false,toolGrants:{read:[],write:[]}}` → 取 `plaintext`;
   - `POST /api/projects` + `POST /api/projects/{p}/todos` 建探针任务(记下 todoId);
   - daemon(worktree 代码,scratch home,后台):`cd <repo>/apps/daemon && env PACMAN_HOME=/tmp/pacman-stop-daemon-home pnpm exec tsx src/cli.ts start --foreground --server http://127.0.0.1:8791 --api-key <plaintext> --team <teamId> --name verify-mbp`;等 `GET /api/teams/{t}/machines` 出现 `online:true` 行。

- **全链。** Run `VERIFY_REPO_ROOT=<repo> STOP_DAEMON_HOME=/tmp/pacman-stop-daemon-home node <skill>/scripts/drive-stop.mjs <todoId>`(从 repo 根跑,@playwright/test 才解析得到)。它完整走:详情页 开始 → **#318 统一 start dialog(`.overlay-panel`)→ 先做规划** → `.composer-stop` 出现(截图 01)→ 点击开弹层、断言默认勾选与标签文案(截图 02)→ 停止 → 「正在停止…」(截图 03,窗口 = abort→done(stopped)→SSE 重取,约 0.3–2s)→ `.chat-stamp-cancelled`「已取消」+ 开始钮回位(截图 04)→ 三面真值:API(todo phase=todo、build errorMessage=已取消、steps 含 stopped、迟到 stop 409)+ SQLite(step/build/stop_pending 清零/todo 行)+ daemon.log(`stop delivered step=` / `step stopped by user (discard=true)`)。证据 `result.json` 15 checks。
  - seed 必须留 todo 在 **`todo` 相位**(只建 provider/agent/project/todo + api-key/enroll,**不调 startBuilds**)——否则 daemon 在线会秒 claim 进 planning,「开始」钮消失。drive-stop 自己点「开始」触发起 build。
- **收尾。** 杀 daemon 与 stub(按自己起的 pid/任务,不按名杀)→ `cleanup.mjs`。scratch daemon home(/tmp)随手删。

## Gotchas

- daemon 是第四进程,`cleanup.mjs` 不管它——自己起的自己收;stub 同理。
- daemon 继承 shell 代理 env(`Proxy: http://127.0.0.1:7890` 行)——localhost 目标通常直连,若 claim/流不通先疑代理。**6 个 proxy env 全 unset**(`HTTP_PROXY HTTPS_PROXY http_proxy https_proxy all_proxy ALL_PROXY`——只 unset 大写或小写会被另一组拦,daemon enroll 报 401 而 curl 直连同 key 报 200 = 典型代理症状)。
- **`PACMAN_HOME` 透传**:bash `VAR=val nohup pnpm exec ...` 嵌套时 env 可能不透传到孙进程,daemon 退回默认 `~/.pacman`(用户真数据!)。用 `export PACMAN_HOME=...` 再 nohup,启后必查 `cat /proc/<pid>/environ | grep PACMAN_HOME` 或 `<home>/machine.json` 是否新写。
- **vite proxy 默认指 8787**(用户 dev 端口):起 vite 必须带 `PACMAN_DEV_SERVER_PORT=<verify server 端口>`,否则浏览器 API 全 502 → React 不 hydrate → 页面零按钮(drive 脚本 timeout 找不到「开始」)。
- **stub LLM Node ≥v20 close bug**:`stub-llm-verify.mjs` 旧版用 `req.on('close')` 清延迟 timer,但 Node ≥v20 该事件在请求正常收完(end 后)即触发 → timer 每次被即时清 → stub 永不响应(daemon 侧 `stream timeout first=300000ms`)。已修为 `res.on('close')` + `responded` 守卫;若 stub 挂死先查此处。
- 「正在停止…」窗口窄:drive 脚本点击后立即 waitForSelector(4s);miss 时落 `03-stopping-transition-missed.png` 且该 check 记 false(非致命,稳态证据仍在)——别把 missed 当 bug 追。
- stop 只对**活动步**生效:步已收尾再点(或再 POST)= 409(UI 上停止钮随 running 消失,弹层确认后 409 静默收敛,无输入可丢)。
- pending 步(机器未领)停止 = server 即时取消,无 daemon 参与(`{delegated:false}` 200);live daemon 在跑时该窗口毫秒级,probe 走的是 claimed 路径。
- fish/zsh 方言:`--api-key $(cat file)` 用 `$()` 不用 `()`(Bash 工具 zsh 方言,裸 `()` 当 glob 报错)。
- 重验 = 重 launch + 重新 seed + 新探针任务(api-key/provider 幂等性不保证,别复用旧栈)。
- **fresh 详情页两枚「开始」**(banner dhead primary + 主 pane `.fresh-start`,XMON-72 实测):`getByRole('button', {name:'开始'})` strict mode 必撞双;drive-stop 锚 `.fresh-start`。将来票若摘掉 fresh-block 大钮,锚点随之改。
