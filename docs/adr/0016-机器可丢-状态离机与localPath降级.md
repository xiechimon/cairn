# ADR 0016 · 机器可丢：状态离机，localPath 降级为单机器缓存

> 状态：**已裁决**（2026-10-10）。地图票 #1147，本文档落地票 #1152。
> 触发：用户目标形态——随时在 VPS / 闲置机上开发，本地电脑关机任务不停；云端机器坏掉不丢进度与开发状态。
> 后继：ADR 0017（双执行源）——github 形态项目可加挂 localPath 作同机执行加速位；本文裁决不变，可丢性仍只属 githubRepo。

## Problem Statement

要「任何机器都能开发、机器死了不丢进度」，先回答真值住哪。两个候选：

- **状态随机**（Amp orb 模式）：每线程一台机器，卷快照 + 休眠唤醒，平台保活。前提是平台无限供应 VM 与快照底座——自有硬件没有。
- **状态离机**：真值全部推出执行机，机器是纯缓存；「恢复 = 另一台机器重新物化 + 从线程继续」。

## 侦察事实

| # | 事实 | 出处 |
|---|---|---|
| F1 | 任务 / 线程 / 方案文档的真值在 server DB，不在执行机 | 仓 schema + CONTEXT.md |
| F2 | 代码真值在 git remote：daemon 每步收尾 commit+push（步边界粒度，含 hosted 移除后的 github/local 两形态） | `apps/daemon/src/runner.ts` 收尾面 |
| F3 | 步内未提交改动是唯一会丢的面；WIP 步内推送能把窗口缩到分钟级，但给 git 历史添噪音——Multica 连步边界 commit 都没有（丢整个工作区），pacman 现状已优其一档 | r10 §5、裁决记录 #1147 |
| F4 | Multica 的 squad leader 任务**无并发豁免**（`CountRunningTasks` 全计）；协调者防堵靠 per-agent 配额 + 上游 #7344 目录锁豁免 | 2026-10-10 浅克隆复核：`daemon.go:5349` / `agent.sql:1780` / `local_directory.go:108-150` |
| F5 | pacman 的 chief 是独立实体、不是「众多 agent 里的一个」，per-agent 配额无可搬性 | CONTEXT.md「执行体」节 |
| F6 | 环境重建的成熟形态 = 仓内生命周期钩子：`.agents/setup`（幂等装机、超时杀树）+ `.agents/resume`（唤醒修复） | `docs/research/amp-native-sandbox-orb.md` §3.2 |
| F7 | localPath 形态的真值就是该机文件系统——机器死了连已提交的都回不来 | CONTEXT.md「仓库」词条（修订前） |
| F8 | server 部署在 tailnet 内（mea），GitHub webhook 打不进来；CI 状态只能轮询 | #1147 裁决 6 |

## Decision

1. **状态离机**：任务真值在 server DB，代码真值在 git remote，环境真值在仓内 `.agents` 钩子（F6）；机器是可丢缓存。不做跨机迁移、不做休眠卷续命、不做容器层（同机并发互踩由 `PACMAN_PORT_BASE` 端口基座覆盖，见 #1148）。
2. **不做 WIP 推送**（F3）：机器死了丢「当前步内自上个步边界起的未提交改动」，接受该窗口。理由：git 历史的噪音成本 > 自用场景下步内丢失的期望损失；Multica 同位对照（更差）说明这不是落后。
3. **localPath 降级为「单机器缓存」形态**（F7）：不砍（本地快试有用），但 CONTEXT.md 词条与项目创建面常驻标注「机器损坏，进度随机器走」；可丢性只属 `githubRepo`。
4. **chief 步不占并发槽**（F4/F5）：并发上限只辖 worker 步；chief 是调度员不是干活的，永不被 worker 占满饿死。
5. **server 钉常开机 + DB 定时备份**：控制面是唯一单点（F1），mea 常开承载，`sqlite3 .backup` 每小时送 dmit（RPO 1h），恢复演练归 #1151。

## Premortem（假设本裁决错了，三个最可能的死因）

1. server DB 真丢（mea 硬件死 + 备份链同断）→ 护栏 = #1151 小时级备份 + 副本恢复演练；RPO 1h 写进票面。
2. 「localPath 降级」被误读成「localPath 不可用」→ 护栏 = UI 标注只陈述事实（进度随机器走）不做禁用；词条写清两形态各自的真值位置。
3. chief 不占槽在小内存机器上 oversubscribe（上限 + K 个 chief 回合挤爆）→ 护栏 = chief 回合是轻量编排对话；真撞了再加 chief 并发软上限，本 ADR 不预留。
