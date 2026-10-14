# #1241 机器推荐并发：实时环境证据

分支 `concurrency-1241`（worktree `/workspace/wt-1241`，issue #1241，#1241 PR 待合并）。

驱动探针：`.claude/skills/verify-pacman/scripts/drive-1241-recommended-concurrency.mjs`
（`scripts/drive.mjs` 注册的同一族定制 probe；五断言族 A 推荐 / B 依据 / C 手动 / D 恢复推荐 / E 估算）。

## 实时环境

| 维度 | 值 |
|---|---|
| 主机 | `grok-bot-vm-481311088`（Linux x86_64，Docker 容器） |
| 核数 | 8（`os.cpus().length`） |
| 总内存 | 16 002 MiB（≈ 15.6 GiB，`os.totalmem()`） |
| 可用内存 | 4 931 MiB（≈ 4.8 GiB） |
| 公式 | `min(8, floor(16002 / 2048)) = min(8, 7) = 7` |
| 推荐值（measured） | 7 |
| 估算值（estimate，无指纹） | 3（`CONSERVATIVE_CONCURRENCY`） |

## 端口与栈

本机端口舰队中 8791 已被 `sand-egress-tun`（pid 363，系统服务，禁杀）占用，按
skill「端口与车道纪律」换用 `8796` / `5278`（任务规约内的 fallback），同栈对照
before / after，避免端口漂移串扰。

| 栈 | REPO_ROOT | RUN_DIR | server | web |
|---|---|---|---|---|
| before | `/tmp/wt-1241-before`（origin/main HEAD `9b027a5c`） | `/tmp/wt-1241-before/.claude/verify-run` | 8796 | 5278 |
| after | `/workspace/wt-1241`（`concurrency-1241` `6cf9cd74`） | `/workspace/wt-1241/.claude/verify-run` | 8796 | 5278 |

## 公式（apps/server/src/services/dispatch-eligibility.ts）

```
recommended = clamp(min(cpuCores, floor(memoryTotalMb / 2048)), 1, 16)
```

常量：`CONCURRENCY_FLOOR = 1`、`CONCURRENCY_CEILING = 16`、`MEMORY_GB_PER_SLOT = 2`、
`CONSERVATIVE_CONCURRENCY = 3`。**口径 = 总内存**（`memoryTotalMb`，非 `memoryAvailableMb`），
依据弹层文案「总内存 15.6 GiB」与 B1 断言对齐；可用内存仅展示于依据块副位。

## 优先级（issue #1241 评论，2026-10-12 binding）

```
用户 PATCH 数字  >  公式（measured，有指纹）  >  保守估算（estimate，无指纹）
```

| 状态 | maxConcurrentOverridden | maxConcurrent | concurrencySource | 推荐字段下发 |
|---|---|---|---|---|
| 用户写过 | true | 用户值 | manual | 公式值 |
| 未覆盖，有指纹 | false | 公式值 | measured | 公式值 |
| 未覆盖，无指纹 | false | 3 | estimate | 3 |

PATCH `null` = 清除覆盖，立即按当前指纹重算；心跳缺 `hardware` 沿用上拍指纹，
不把已测推荐打回估算；负载暂停仅挡新 claim、覆盖时不生效。

## 证据清单

`docs/verify/1241/`
- `before/` —— origin/main 一次性 worktree 栈实测
  - `00-before-machines-page.png`：双机并排（真机 + 估算机），均「并发 3」无标注
  - `api-machines-t0.json`、`db-machine-t0.json`：双真值字段 `maxConcurrent=3`、无
    `recommendedConcurrent` / `concurrencySource`
  - `daemon-console.log`：daemon 启动与上线行（无 fingerprint 字段）
  - `result.json`：3/3 PASS（O1 / O2 / O3）
- `after/` —— concurrency-1241 实测（同一端口 8796/5278，同主机指纹）
  - `01-recommended-tag.png`：真机控件「并发 7 推荐」、估算机「并发 3 估算」
  - `02-basis-popover.png`：依据弹层「推荐 7 · 依据：核 8 · 总内存 15.6 GiB · 负载 1.01」
  - `03-manual-override.png`：选 4 后「并发 4 手动」
  - `04-after-reset.png`：恢复推荐后回到「并发 7 推荐」
  - `05-estimate-basis.png`：估算机弹层「未收到能力指纹，按保守默认 3 估算」
  - `api-machines-t0.json` / `api-machines-after-manual.json` /
    `api-machines-after-heartbeat.json` / `api-machines-after-reset.json`：四时点
    API 真值，覆盖 `concurrencySource` 三态 + 公式值与用户值并存 + 心跳不覆盖
  - `db-machine-*.json`：四时点 SQLite 行级真值（`maxConcurrentOverridden` 0/1 切换、
    `capabilities.hardware` 字段落库）
  - `daemon-console.log`：真 daemon 上线行（含 hardware 字段上报）
  - `result.json`：20/20 PASS（A0..A5 / B1 / C0..C4 / D0..D3 / E0 / E2..E4）

## 双向对照（before vs after）

| 维度 | before（origin/main） | after（concurrency-1241） | 判据 |
|---|---|---|---|
| 真机 UI 控件 | 「并发 3」 | 「并发 7 推荐」 | O1 红 / A1 红 |
| 估算机 UI 控件 | 「并发 3」 | 「并发 3 估算」 | O2 红 / E0 红 |
| 真机 API `recommendedConcurrent` | 字段缺失 | 7（公式值） | O3 红 / A2 红 |
| 真机 API `concurrencySource` | 字段缺失 | `"measured"` | O3 红 / A0 红 |
| 依据弹层 | 无 | 「依据：核 8 · 总内存 15.6 GiB · 负载 1.01」 | — / B1 红 |
| PATCH 数字 → 手动 | 不支持该语义（无来源字段） | 「并发 4 手动」、SQLite `maxConcurrentOverridden=1` | — / C0/C1/C2/C3 |
| 心跳覆盖手动值 | — | 30 s 后仍是 4（覆盖值持久） | — / C4 |
| 恢复推荐 | — | 「并发 7 推荐」、`overridden=0` | — / D1/D2/D3 |
| 估算机 capabilities | （无字段） | null，公式不执行，值固定 3 | — / E2/E3/E4 |

## 失败方式逐条钉死

| 失败模式 | 探针断言 | 判据字段 |
|---|---|---|
| 公式漂移（floor→ceil、内存口径错） | A2 | `recommendedConcurrent === min(cpuCores, floor(memoryTotalMb/2048))` |
| 依据吃可用内存 | B1 | 弹层文案含「总内存 15.6 GiB」（非 4.8） |
| 心跳覆盖手动值 | C4 | `maxConcurrent === 4` 且 `lastSeenAt` 前进 |
| 恢复推荐后 `overridden` 残留 | D2 / D3 | API+SQLite 均 `maxConcurrentOverridden === false/0` |
| 无指纹机被说成推荐 | E0 / E2 | `data-concurrency-source="estimate"`、API `capabilities=null` |

## 复跑配方

```sh
# before 栈（origin/main 一次性 worktree）
VERIFY_REPO_ROOT=/tmp/wt-1241-before VERIFY_PORT=8796 VERIFY_WEB_PORT=5278 \
  VERIFY_RUN_DIR=/tmp/wt-1241-before/.claude/verify-run \
  node /workspace/wt-1241/.claude/skills/verify-pacman/scripts/launch.mjs
VERIFY_REPO_ROOT=/tmp/wt-1241-before VERIFY_RUN_DIR=/tmp/wt-1241-before/.claude/verify-run \
  node /workspace/wt-1241/.claude/skills/verify-pacman/scripts/drive-1241-recommended-concurrency.mjs --expect=old
VERIFY_RUN_DIR=/tmp/wt-1241-before/.claude/verify-run \
  node /workspace/wt-1241/.claude/skills/verify-pacman/scripts/cleanup.mjs

# after 栈（concurrency-1241）
VERIFY_REPO_ROOT=/workspace/wt-1241 VERIFY_PORT=8796 VERIFY_WEB_PORT=5278 \
  VERIFY_RUN_DIR=/workspace/wt-1241/.claude/verify-run \
  node /workspace/wt-1241/.claude/skills/verify-pacman/scripts/launch.mjs
VERIFY_REPO_ROOT=/workspace/wt-1241 VERIFY_RUN_DIR=/workspace/wt-1241/.claude/verify-run \
  node /workspace/wt-1241/.claude/skills/verify-pacman/scripts/drive-1241-recommended-concurrency.mjs --expect=new
VERIFY_RUN_DIR=/workspace/wt-1241/.claude/verify-run \
  node /workspace/wt-1241/.claude/skills/verify-pacman/scripts/cleanup.mjs
```

## 实测坑

1. **端口 8791 占用**：`sand-egress-tun`（pid 363，系统服务）已占 8791，不能杀，按
   skill 纪律换 8796/5278。
2. **核心 `pnpm` 不可用**：`/home/box/.cache/corepack/pnpm/12.5.1/bin/pnpm.cjs` 文件
   缺失；用 `/tmp/1241-bin/pnpm`（指向 `/usr/local/share/corepack/pnpm/10.34.6/bin/pnpm.cjs`）
   启动 pre-commit 钩子；`corepack pnpm exec tsx` 在 `apps/<pkg>/` 子包下可解析
   `node_modules/.bin/tsx`，跨子包桥迁可用。
3. **同跑需重 launch**：`vite` 的 `**/.claude/**` watch 忽略不会罩住 `apps/web/src`，
   但 worktree 自带的 `.claude/verify-pacman/scripts/` 不在 watch 范围，栈运行中改
   probe 脚本不会热生效——重 launch 即可（launch 走 detached 重读 `launch.mjs`）。