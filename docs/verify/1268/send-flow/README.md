# #1268 发送流行为对齐 + 对话流行为复刻 — 实测证据

2026-10-12~13，真链路栈（web 5273 + server 8791 + daemon chain-demo +
Builder agent，claude-code runtime，glm-5.3），驱动脚本 =
`.claude/verify-run/drive-*.mjs`（运行时目录，gitignored），参照侧 =
本机源码构建的 dsh web（`drive-dsh.mjs`，一条测试消息）+ dsh 源码
（scratch/dsh-ref/deepseek-harness，读后可能已清；配方沉淀在 wiki
[[DeepSeek Harness 的界面配方]]）。

## 2026-10-13 夜：行为复刻批（第二晚）

- `pacman-user-turn-anatomy.png` + `-facts.json`：dsh 用户行解剖——右贴
  气泡（42px 药丸、70% 列宽上限、零头像）、气泡下贴右的时钟 + 28px
  复制钮、新近律（实测 copyOpacity：早先回合 "0"、最新回合 "1"）。
- `pacman-process-timeline.png` + `-facts.json`：发送黑盒拆除——展开的
  live 行带过程时间线（00:50:38 准备工作区 → 正在连接模型 → 模型思考中，
  逐相位 HH:mm:ss）+ 最近信号 4s 前；折叠行静默超 10s 挂「· 信号 Ns 前」
  走表（单测 W12–W14 钉 mapper 半）。
- `pacman-process-fold.png` + `-facts.json`：落定回合过程折叠——「过程 ·
  完成 10s ›」单行（全宽 + 0.5px 底缝 + chevron 180°/100ms），展开收拢
  滑行实测 0.15s（grid-rows 1fr↔0fr）；在飞回合的过程组不折（live 尾）。
- 代码块横幅（语言标签 + 复制钮恒显，copy→check 1s 换回）与答复行动作
  簇尾部的消息时钟（dsh clock='end' 位）随批落地（chat-markdown /
  ActionRow）。
- 本批发现的既有缺陷（与本 lane 无关，未顺手修）：#1279 restart 组合行
  漏过 classifyUserText 渲染成用户气泡。

## 2026-10-12：发送流批（第一晚）

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
- 分支覆盖精确口径（2026-10-13 补正）：回声存在后实测过三条分支——
  confirm 驳回（本包帧）、building steer（steer 探针）、failed 带反馈重启
  （settle-fold 驱动的发送腿）；review 静息驳回分支在回声落地前的首跑
  覆盖（其写入路径与 failed-restart 同一 mutateAsync 形态，分歧只在相位
  判定）。四条分支共享同一 onOptimisticSend/clearOptimisticSend 口。

## 不搬的（划界）

- 鲸鱼/品牌动效（DeepSeek 商标面）。
- 待定阶段的停止钮：步未认领时没有可停之物，钮面只在真 running 时出现
  （形必须带义；dsh 的即时停止取消的是客户端请求，pacman 的停止是服务端
  步语义，不摆不能用的钮）。
- ~~行挂载/卸载时的间距滑行~~（2026-10-13 核销）：复读 dsh 源码后确认
  data-chat-motion 的 margin-top 过渡只服务于 fold clock 编排（折叠行长入
  与过程区收拢同一拍）——该编排已 1:1 落地（grid-rows 收拢 150ms +
  fold-row-in 长入同行，实测 foldEnterClasses=[true]）；行挂载本身在 dsh
  不播动画（帧证），pacman 同。无残余滑行缺口。
- 总管抽屉发送面：有自己的 #1216 在飞指示族，本批只管详情页发送流。
