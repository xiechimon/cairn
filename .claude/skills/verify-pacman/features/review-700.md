# review-700 — verdict 提取真链（#700 B-C13）

票：#700（B-C13，#519 实测：审核步 verdict JSON 之后又调 set_task_meta，「审核结论」静默丢弃）。probe 走**真 daemon 全链**（区别于 drive-review-blocking 的 server 直投 done：那条不进 daemon 提取面），stub 回放 #519 形状——verdict JSON 文本与 set_task_meta 工具调用同轮发出，daemon transcript 落行序 = 文本行在前、工具行在后（正是击穿旧提取器的形状）。

## Drive (vp.mjs)

- `vp.mjs drive review-700 verdict-extraction`

前置（stack / daemon / stub-llm …）、状态与脚本参数：`vp.mjs list review-700`。`vp.mjs` = `node .claude/skills/verify-pacman/scripts/vp.mjs`。

## How to get to it (user POV)

- 用户不直接触发提取：审核步在任务详情页（`/app/todo/:id`）跑完后，审核面显示结论或「判定提取失败」行。本 probe 走真 daemon 全链复现这一面。

## 覆盖

- 场景 B（提取失败面）：stub 纯散文 → daemon `findingsError` → server verdict 消息 conclusion「判定提取失败」+ `extractionError` 原因上浮 → web 审核面 danger 色 tag 行（区别于旧兜底「审核未返回结论」）→ 不触发修订（phase 留 confirm、无新 plan 步）。
- 场景 A（#519 形状面）：verdict JSON + 尾部 set_task_meta 工具行 → verdict 照常提取（findings 落库）→ blocking → review→planning 回流（revise note + 重规划步入队 + prompt 注入审核事实）→ set_task_meta 真执行（todo 标题改写）。
- stub 对重规划轮（daemon 下发的 CONTINUE_PROMPTS.plan 文本）**延迟 30s** 响应 = planning 相位窗口恒开，断言无竞态；probe 收尾 cleanup 整栈丢弃，该步不收尾。

## 前置与跑法

```sh
# 1. 栈（worktree 代码）
VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-pacman/scripts/launch.mjs
# 2. stub（分档见脚本头注释；marker: EXTRACT-FAIL-MARKER=场景 B / Blocking findings=重规划延迟轮）
STUB_PORT=8921 node .claude/skills/verify-pacman/scripts/stub-review-700.mjs &
# 3. seed（两个 todo = 两场景；provider baseUrl 指向 stub）
VERIFY_REPO_ROOT=<worktree> STUB_LLM_URL=http://127.0.0.1:8921/v1 \
  node .claude/skills/verify-pacman/scripts/setup-review-700-seed.mjs   # stdout JSON
# 4. 真 daemon（第 4 进程，cleanup.mjs 不管它——自己起自己收）
cd <worktree>/apps/daemon && env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  -u all_proxy -u ALL_PROXY PACMAN_HOME=/tmp/pacman-review700-daemon-home \
  corepack pnpm exec tsx src/cli.ts start --foreground \
  --server http://127.0.0.1:8791 --api-key <seed 的 apiKeyPlain> \
  --team <seed 的 teamId> --name review-700-mbp
# 等 GET /api/teams/<teamId>/machines 出现 online:true
# 5. probe
VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-pacman/scripts/drive-review-700.mjs <todoA> <todoB>
```

## Gotchas

- daemon 启动**6 个 proxy env 全 unset** + `PACMAN_HOME` 显式 scratch（透传坑见 stop-button.md）——否则 enroll 401 / 污染 `~/.pacman`。
- 场景先 B 后 A：B 终态稳定（不触发修订）；A 的重规划轮被 stub 延迟撑窗，probe 结束即 cleanup。
- seed 的 plan 步由 seed 自己 claim/done（daemon 未起时）；daemon 起在 seed 之后，只碰 review/重规划步。
- stub 轮次判别**不能** `body.includes('tool')`（tools 定义数组含该词）——按 `messages` 含 `role:'tool'` 行判第二轮。
- **重规划轮判据 = `请重新规划该任务`（CONTINUE_PROMPTS.plan 文本）**：daemon 对 continue-session plan 步下发的是通用续轮指令——步表里存的 REVIEW_REVISE_PROMPT 不走 claim instruction 面（审核事实经被续会话的历史送达 agent）。拿 'Blocking findings' 当判据永远不命中，延迟轮失效 = planning 窗口竞态（首轮实测踩过）。
- messages API 返回的 `content` 是**解析后的值**（block 数组 / toolcall 对象 / 字符串）——匹配前统一 stringify。
