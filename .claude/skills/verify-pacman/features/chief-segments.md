# 段行封口（#955 / ADR 0011）

总管跑一个回合时，模型的连续输出按「一段连续同类型增量」在**写入端**（daemon）封成
transcript 行——封出即落 journal + 实时上报（第五形 `transcript_row`，server 先落库
再广播）。于是流式期与落库期同源：同一个段既是流式期即时出现的那条行，也是终稿里的
那条行。工具调用是独立记录（不是段）；思考按段单列一行。封口触发 = 类型变化 /
工具到达 / 消息结束 / 步收尾。

客户端**不做任何切分**：每段实时落库后，web 既有的 #857 handoff 自己就把那一轮文本
变成落库行，打字尾行只剩「当前未封段」。

## Sub-features

- `segment-order` — 正文段排在它之后的工具行**之前**（工具到达那一刻先封段）。落库行
  的 createdAt 强制单调，段序不因同毫秒并列而抖。
- `thinking-row` — 思考段单列一行（折叠态一行斜体预览、展开看全文），抽屉与详情页共用
  `components/chat/agent-rows.tsx` 的 `ThinkingRow`。
- `inflight-tool-row` — 回合在飞（`activeRun` 非空）时工具行**平铺**进主呈现，进行中
  的那条挂「正在调用 X + 秒数」（秒数锚 = 该次调用的真实起点，无锚不摆数字）；回合
  收口后折回 robot 行的「展开过程」披露（r5 canon 的落库形）。
- `hub-clear-law` — 在飞文本缓冲只由「工具行 / 仅思考行」以外的落库行终结。工具行
  的上报带 500ms/2000ms 重试链、可能迟到，旧律（任何行都清）会把正在流的下一段抹掉。

## Drive (vp.mjs)

- `vp.mjs drive chief-segments avatar-geometry`
- `vp.mjs drive chief-segments compress-model-select`
- `vp.mjs drive chief-segments segment-sealing`
- `vp.mjs drive chief-segments stream-catchup`
- `vp.mjs drive chief-segments threads-scroll`

前置（stack / daemon / stub-llm …）、状态与脚本参数：`vp.mjs list chief-segments`。`vp.mjs` = `node .claude/skills/verify-pacman/scripts/vp.mjs`。

## How to get to it (user POV)

- 开 chief 抽屉（⌘J）发一句话，看它逐段出现：思考一行、正文一行、工具一行（进行中带秒）。
- 详情页（worker 步）同形。

## Driving it with drive-chief-segments.mjs

Preconditions: `launch.mjs` 已起隔离栈（全新库）；proxy env 全 unset。

```sh
env -u http_proxy -u https_proxy -u all_proxy VERIFY_REPO_ROOT=<worktree> \
  node .claude/skills/verify-pacman/scripts/drive-chief-segments.mjs
```

铺底全走公开 REST + 假机器（provider / agent / PATCH chief / POST chief/threads /
api-key / machine enroll / claim），然后按**封口后的真 wire 序**推帧：`transcript_delta`
（在飞文本）、第五形 `transcript_row`（段行）、既有形 toolCallRecord（工具行两半）。
零 daemon、零 LLM。9 条断言：段序 / 段行形状 / 先落库再广播 / 迟到进场不变量 /
幂等 / 工具行开始半落库 / 抽屉三条 DOM。证据 `docs/verify/955/`。

daemon 侧的封口本身由 `apps/daemon/test/segment.test.ts`（段缓冲 10 条）与
`apps/daemon/test/machine-loop.test.ts`（全链行序）钉。

## Gotchas

- **行 id 每次运行必须唯一**：`chief_message` 的幂等 upsert 以 id 为冲突键且 `set` 不改
  `threadId`——复用同一个 `call-1` 会让第二次运行的行写回**第一次**的线程。
- **外部只读连接读不到刚落的行**：服务端连接持有 WAL，新开连接会读到旧快照。断言走
  server 自己的读面（`GET /api/conversations/{id}/messages`），SQLite 只作落盘实物。
- 读面回的 `content` 是**已解析**的数组/对象，探针内部发的是字符串形。