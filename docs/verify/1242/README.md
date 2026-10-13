# #1242 项目身份可变面 — verify-pacman 证据

probe：`.claude/skills/verify-pacman/scripts/drive-1242-project-identity.mjs`（纯 live 栈 + 假机器 wire + 浏览器真用户路径，零 daemon 零 LLM）。两遍独立运行 16/16 PASS（2026-10-12T20-25-06 / 2026-10-12T20-25-28 两时间戳目录同判据；仓内归档取第二遍）。

## 复跑配方

```sh
node .claude/skills/verify-pacman/scripts/launch.mjs     # 全新库（依赖：local 项目创建闸 + 假机器 enroll 顺序）
node .claude/skills/verify-pacman/scripts/drive-1242-project-identity.mjs
node .claude/skills/verify-pacman/scripts/cleanup.mjs
```

出站前置：转换腿的可达性校验真调 `GET api.github.com/repos/octocat/Hello-World`（公开仓匿名梯；本机直连已验 200，无 token 依赖）。`agent` 创建先 `machine/enroll` 拿 machineId（#1259 起归属机必填）。

## 判读表（16 checks ↔ 票面验收）

| 腿 | check | 票面对应 |
|---|---|---|
| S0 | 铺底：local 项目（scratch 真 git 仓）+ 3 todo + 假机器 | — |
| C1 | 转换前 claim 载荷 repo = `{kind:local, cloneUrl:<本机路径>}` | 转换前基线 |
| A1 | 空 body → 400（五键全缺 = 静默 no-op 族判死） | 失败方式 4 |
| A2 | 未知字段 → 400（strict 明示拒绝） | 失败方式 4 |
| B1 | 设置页改名 → PATCH 落库 + invalidate 回显 | 改法 3 / 验收 2 |
| B2 | 改名生效于侧栏与卡面（01-board-renamed.png） | 验收 2 |
| C1/C2 | 描述落值 / 清空 → 列 null（空 ≡ null） | 改法 3 |
| D1 | 有在飞 build 时转换 → 409 + toast 可见（02-convert-409-toast.png） | 失败方式 1 / 验收 3、4 |
| D2 | 409 后行未动（仍 local） | 失败方式 1 |
| E1 | 转换落库：repoKind=github + githubRepo + localPath 保留（local 绑定转加速位） | 改法 2 / 验收 1 |
| E2 | 转换后设置页：转换卡卸载、加速位行上线（03-settings-converted.png） | 改法 3 |
| E3 | record cloneUrl 切 https 派生（04-project-record.json） | 改法 2 |
| E4 | 注记：改名 1 行 + 转换 2 行（05-system-notes.json；#902 坑：content 是 json 列，JSON.parse 后比对） | 改法 4 |
| E5 | todo 详情 transcript 可见注记行（06-transcript-note.png） | 改法 4（板面可见） |
| F1 | 转换后 claim 载荷 repo = `{kind:github, cloneUrl, localPath}` | 改法 2（既有步按新形态解析）/ 验收 1（clone 臂 + 加速臂） |

## 实测坑（三条，changelog 同文）

1. claim 响应解包：worker 步的 `body.step` 是 ClaimedStep 全形（project/todo 面在内），其 `.step` 字段是内层步位——套用 drive-903 的 chief 双包解包（`payload?.step ?? payload`）会把 claimed 解成内层步对象，`project.repo` 恒 undefined。
2. 探针读输入值必须轮询收敛（e2e toHaveValue 同语义）：invalidate 重取的 React 重渲染比网络回包晚一拍，单次 `inputValue()` 读的是点击前旧态。
3. 探针判据必须等 invalidateAll 重取收敛后再截图/读值（waitForResponse 拿 GET /api/projects 回包）——#1251 坑①同源。

## mea 双机验收面（票面验收 1 的真机半）

票面「转后在 mea 可建卡施工（clone 臂）且本机走 localPath 加速臂」的机器半已由 F1 的 claim 载荷双臂判据钉死（daemon 双条件选源逻辑 = #1213 的 ADR 0017 既有面，本票不改）；用户实机上的 pacman 主实例转换由用户在 UI 自行执行（本 PR 合并部署后）。
