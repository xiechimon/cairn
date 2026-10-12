# #1268 发送流行为对齐 — 实测证据

2026-10-12，真链路栈（web 5273 + server 8791 + daemon chain-demo + Builder
agent，claude-code runtime，glm-5.3），驱动脚本 =
`.claude/verify-run/drive-pacman-send.mjs` / `drive-pacman-steer.mjs`
（运行时目录，gitignored），参照侧 = 本机源码构建的 dsh web
（`drive-dsh.mjs`，一条测试消息）。

## 参照侧实测（dsh，dsh-motion-facts.json + dsh-send-00.png）

回车后 200ms 帧：自己的气泡已上屏（**零入场动画**，motion-facts 里气泡
animationName 不出现）、跑动行「深度求索中，用时 1 秒…」同帧挂载（扫光 +
走秒）、composer 已清空、发送钮原地变停止钮、侧栏会话即时出现。

## pacman 对齐前实测（同驱动首跑）

发送后 ~3.1s 气泡才回显、~3.9s 跑动行与停止钮才出现——写库 + daemon
认领回路期间的零反馈窗口；气泡另有我方自行发挥的 150ms 浮入（dsh 无）。

## 对齐后（本批）

- `pacman-send-instant.png`（confirm 驳回路径，回车后 ~0.7s 帧）：回声气泡
  + 「处理中...」待定行已同帧在屏，composer 已清。
- `pacman-send-handoff.png`（+0.5s）：待定行无闪灭交接给真行
  「1s 准备工作区...」（真秒数从步认领起点开走，不摆冻结/虚数），停止钮
  同步就位。逐帧探针 = pacman-confirm-path-facts.json（无 live=False 死帧、
  气泡数恒定不双份）。
- `pacman-steer-order.png`（building 中 steer 补话）：回声气泡插在活尾巴
  （打字面 + 跑动行）之前，序与 dsh 一致；探针 = pacman-steer-facts.json
  （跑动行全程不断帧）。
- 气泡入场动画撤除：全帧序列 `lastBubbleAnim = none`，钉进
  `visual-polish.spec.ts` 的 detail face 用例（animationName === 'none'）。

## 不搬的（划界）

- 鲸鱼/品牌动效（DeepSeek 商标面）。
- 待定阶段的停止钮：步未认领时没有可停之物，钮面只在真 running 时出现
  （形必须带义；dsh 的即时停止取消的是客户端请求，pacman 的停止是服务端
  步语义，不摆不能用的钮）。
- 落定折叠的 160ms 间距滑行（dsh data-chat-motion margin transition）：
  动 message-scroller 布局层的手术，本批不动，另票再议。
- 总管抽屉发送面：有自己的 #1216 在飞指示族，本批只管详情页发送流。
