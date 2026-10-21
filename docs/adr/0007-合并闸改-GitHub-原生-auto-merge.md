# ADR 0007 · 合并闸改 GitHub 原生 auto-merge

> 状态：**已裁决并生效**（2026-10-01）。D4 于 2026-10-16 翻转为 `strict: true`，见文末「修订 · 2026-10-16」。
> 来源：并行车道期靠 agent 起一个 20 秒轮询的哨兵抢 CLEAN 窗口。哨兵有两个硬伤——每变一次状态就唤醒一次模型（一次完整回合），且后台监视器有寿命（默认 5 分钟、上限 30 分钟），CI 跑过监视期后哨兵静默自灭，PR 无人接手。

## Problem Statement

多车道并行开 PR，「谁先绿谁合」这段等待由谁盯？此前没有自动合并能力，做法是 agent 起一个每 20 秒跑 `gh pr view` 的后台脚本，状态字母一变就打一行、把模型叫回来。代价是每变一次状态烧一个完整模型回合；且监视器到点自灭，长 CI 之后就是裸奔。

原生 auto-merge 能把整段交给 GitHub：开 PR 时挂上 `--auto`，CI 一绿平台自己合，会话死了也照样生效，零 token 成本。此前的障碍是仓库级设置没开，且 main 上没有必需检查——而 auto-merge 等的正是必需检查。

## 侦察事实（2026-10-01 实测）

| # | 事实 | 出处 |
|---|---|---|
| F1 | 仓库 `allow_auto_merge: false`——`gh pr merge --auto` 直接被拒 | `gh api repos/xiechimon/pacman` |
| F2 | main **无分支保护**：GET protection 返 404 "Branch not protected"，一条必需检查都没设 | `gh api repos/xiechimon/pacman/branches/main/protection` |
| F3 | CI 只有一个 workflow，两个 job：`check` / `pack-smoke`。`pull_request:` 无条件触发（任何车道分支开 PR 都有 CI），`push` 只覆盖 `main` 与 `prototype/**` | `.github/workflows/ci.yml` |
| F4 | **只开 auto-merge 不开保护 = 危险**：auto-merge 等的是 required checks，required 列表为空时分支一可合即合，等于 CI 跑完前就合。故 D1 必须与 D2 同批落地 | GitHub 文档行为，本 ADR 未单独实测（护栏见 Premortem） |
| F5 | 存在「推了提交却没有 CI run」的 PR：#577 head `9b62d567` 零 check-run、零 workflow run | `gh api .../commits/9b62d567/check-runs`、`.../actions/runs?head_sha=` |

## Decision

| ID | 裁决 |
|---|---|
| **D1** | 仓库开 `allow_auto_merge = true` |
| **D2** | main 加保护规则：必需检查 = `check` + `pack-smoke`；`strict: false`；`enforce_admins: false`；不要求 review。检查名逐字取自 check-runs API，非目测 |
| **D3** | 流程约定：开 PR 后即 `gh pr merge <n> --squash --auto`，取代轮询哨兵。PR 未合前不关对应车道 |
| **D4** | `strict: false` 是刻意的：`strict: true`（要求分支先 up-to-date）在多车道下每次合并都会让其余 PR 失效，逼出主动 rebase——而 push 过再 rebase 只能 force-push，被仓规与 hook 双重禁。宁可让 GitHub 按到达顺序串行合 |
| **D5** | `enforce_admins: false` 亦刻意：保住 owner 直接 push main 与手工提前合并的能力，不让保护规则变成把自己锁在门外的锁 |
| **D6** | 保护规则只含必需检查，**不含**「必须先开 PR」——直接 push main 的既有能力不动 |

## 回读校验（改完即回读权威存储，非「已写入文件」）

| 项 | 回读值 | 出处 |
|---|---|---|
| 仓库 auto-merge | `allow_auto_merge: true` | `gh api repos/xiechimon/pacman` |
| main 必需检查 | `["check", "pack-smoke"]` | `gh api repos/xiechimon/pacman/branches/main/protection` |
| strict | `false` | 同上 |
| enforce_admins | `false` | 同上 |
| 是否要求 review | 未要求 | 同上 |

## Premortem（假设已失败，三种最可能死因 + 护栏）

| 死因 | 护栏 |
|---|---|
| **必需检查名写错** → 所有 PR 永久停在「等待状态上报」 | 名字取自 `commits/<sha>/check-runs` 的实际输出（`check`、`pack-smoke`），落规则后回读 `required_status_checks.contexts` 逐字比对 |
| **head 无 CI run 的 PR 永久等待**（F5 实测存在） | 推任意提交即触发 CI；`enforce_admins: false` 保底可人工合。F5 那两条（#577 / #580）本身即 CONFLICTING，本就要 rebase 重推 |
| **base 挪动致冲突 → auto-merge 静默停住** | auto-merge 不解决冲突，只等绿。冲突时 PR 转 DIRTY 且不再自动推进，需人工 rebase——这类事件仍要人接手，auto-merge 免掉的是「等绿」而不是「看冲突」 |

## 修订 · 2026-10-16：D4 翻转为 `strict: true`

### 触发事件

#1368 的 CI 跑于 04:17，当时 main 上 `apps/web/src/detail/composer.tsx` 有 9 处任意间距值。04:51 #1367 合入，加了第 10 处（`pb-[48px]`）。06:24 #1368 凭 04:17 的旧绿合入，同时把该文件的基线冻结为 9。合并结果 main `f7eb56a8` 的 `check` 红（ui-debt-gate：320 > 319）。#1369（CI 04:19）随后同样凭旧绿合入（`9ced1c1a`），此后每个 PR 的 `check` 都继承这条红（#1370）。`strict: false` 允许拿过期的绿合并，这是直接放行点。

### D4 前提复核

D4 的前提「up-to-date 只能 rebase + force-push」不成立。`gh api -X PUT repos/xiechimon/pacman/pulls/<n>/update-branch`（以及 D7 开启后 PR 页的 Update branch 按钮）把 main merge 进 PR 分支，新 head 触发 CI，不改写历史，不需要 force-push。

### 裁决

| ID | 裁决 |
|---|---|
| **D4′** | main 必需检查改 `strict: true`：PR 分支必须已包含 main 最新提交才可合。取代 D4 |
| **D7** | 仓库开 `allow_update_branch: true` |

代价（接受）：merge queue 只对组织仓开放，本仓属个人账号，用不了。每合一个 PR，其余开着的 PR 转 BEHIND，auto-merge 停住，直到有人跑 update-branch 并再过一轮 CI（`check` 实测约 5–6 分钟）。按 10-14 / 10-15 每日 12 / 22 次合并的节奏，多车道会排队串行。

流程：PR 显示 BEHIND 时跑 update-branch。`gh run rerun` 复用旧 merge ref，解决不了 BEHIND。

### 回读校验（2026-10-16）

| 项 | 回读值 | 出处 |
|---|---|---|
| strict | `true` | `gh api repos/xiechimon/pacman/branches/main/protection` |
| main 必需检查 | `["check", "pack-smoke", "e2e-gate"]` | 同上 |
| enforce_admins | `false` | 同上 |
| 仓库 update branch | `allow_update_branch: true` | `gh api repos/xiechimon/pacman` |
| 仓库 auto-merge | `allow_auto_merge: true` | 同上 |

### 修订（2026-10-21，#1435 之后）

#1435 在用户裁决未落时被 auto-merge 合入：车道开 PR 即按 D3 挂了 `--auto`，编排者把 Acceptance 的两个空框勾绿后才去问用户措辞是否可接受，`check` 一绿 GitHub 就合了。当时 `pr-evidence` 不在必需检查里，PR 上也没有任何机器可读的「人工裁决待定」状态。改三处：

| 项 | 改后 | 出处 |
|---|---|---|
| main 必需检查 | `["check", "pack-smoke", "e2e-gate", "pr-evidence"]`，四项均钉 GitHub Actions app（`app_id` 15368，防止任何写权限方用 commit status 冒充） | `gh api repos/xiechimon/pacman/branches/main/protection/required_status_checks` |
| 裁决状态 | 标签 `needs-decision`：`pr-evidence` 见标签即红，标签在身时每次 run 解除 auto-merge（trigger 含 `labeled` / `unlabeled` / `auto_merge_enabled`）；Acceptance 有未勾项时 workflow 自己加标签。摘标签是人的动作 | `.github/workflows/pr-evidence.yml` |
| D3 的前提 | 向用户提问前先 `gh pr merge <n> --disable-auto`，再加标签，再问；裁决落了再重新 `--auto`。agent 摘标签只能带 `PACMAN_DECIDED=1`，`gh pr merge --admin` 没有出口（本机 PreToolUse hook 拦） | `AGENTS.md`「Issues and PRs」 |

不改 `enforce_admins`：它只拦人在网页上的 bypass 按钮和带 `--admin` 的合并，而 agent 侧已由 hook 拦住；要不要连人的 bypass 也关，另议。

### Premortem

| 死因 | 护栏 |
|---|---|
| BEHIND 的 PR 无人 update，auto-merge 永久停住 | 车道收尾与 Auto-fix 事件查 `mergeStateStatus`，为 BEHIND 即跑 update-branch |
| 合并频率高时排队过长 | 双向门：`gh api -X PATCH repos/xiechimon/pacman/branches/main/protection/required_status_checks -F strict=false` 即回到 D4 |
