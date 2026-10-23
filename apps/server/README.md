# @xiechimon/cairn

复刻 server（03 ROADMAP M2）：Hono REST + SSE（全 SSE 无 WebSocket，02 §1.2）、SQLite（better-sqlite3 + Drizzle，migration 进 repo、CI 校验 drift，01 §6）、单用户 seed + team 保形（02 §2）。协议词表单源 = `@cairn/shared`（02 §5/§6 canonical；路由对拍 = `test/wire.test.ts`）。

## 运行

```sh
pnpm dev:server          # tsx watch（开发）
pnpm --filter @xiechimon/cairn start
PORT=8791 CAIRN_HOME=/tmp/cairn-demo bash apps/server/scripts/demo.sh  # demo 面（另窗起 server）
```

## 数据根（单一数据根，备份 = 拷目录，01 §4.2）

默认 `~/.cairn/server/`（`CAIRN_HOME` 覆盖主目录；目录名 = 品牌槽，D3 已触发切换，#109）：

| 文件 | 内容 |
|---|---|
| `server.db` | SQLite 24+1 表（01 §6 锁定清单；WAL） |
| `secretbox.key` | SecretBox keyfile：32 字节随机（base64）、权限 0600、首次启动生成（01 §4.2） |

## 密钥三层（02 §8）

- **at-rest**：provider key、team Secret 值统一 AES-256-GCM 加密落库（信封 = `v1` 版本头 + iv + ciphertext + authTag）；密钥源 = 本地 keyfile，不引外部 KMS/口令派生（Q5 锁定）。
- **运行时**：模型 key per-step 下发（`services/credentials.ts` 解析链；HTTP 端点 `/api/machine/token/{stepId}` 归 M3 接线），executor 内存持有、不落盘常驻；团队 Secret 按 Agent 授权集下发（按 step kind 收窄：plan/review/chief 步恒空），明文只在 `token/{stepId}` 返回值里出现、不预置进任务 shell 环境——daemon 持真值，agent 经 per-step 取用通道显式取用。
- **API 面**：key 类字段**写只读掩码**——GET 永不返回 `apiKey` / secret 值；apiKey 存哈希（SHA-256）不存可逆值，创建响应含明文一次 `cairn_<48hex>`（「请立即复制密钥，它仅显示一次。」），此后列表行掩码 `cairn_afe07565…`。

> **护栏（02 §8 恢复口径）：keyfile 丢失 = 全部存量 provider key 与团队 Secret 值报废，需重录。**
> 加密是磁盘静态保护，不是可恢复备份——「加密 ≠ 可恢复」。备份数据根目录时连同
> `secretbox.key` 一起拷贝即为完整备份；只拷 `server.db` 不拷 keyfile，密文即永久不可解。

威胁模型：self-host 场景 = 本机磁盘静态保护 + 运行时最小暴露；不承诺 todos.dev 云端多租隔离语义（Out of scope，02 §8）。

## 通知（02 §9.1 / 04 §5 divergence 口径）

SSE team stream `notification` 事件三型：`plan_ready`（进 confirm）/ `build_review`（进 review，含定时轮）/ `chief_message`（Chief 线程消息，M4 挂接）；进 done/failed 无事件。行 id = 组合键 `<userId>:<entityId>`（同键 upsert）；未读联动 `GET /api/teams/{id}/notifications` → `{unreadThreadIds}`。无 Web Push/VAPID（已裁决有意 divergence；桌面弹出 = web 页层 `document.hidden` 时 `new Notification()`）。
