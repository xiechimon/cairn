# #1241 存量回填（mon 裁定：旧默认 3 且未手动覆盖 → 跟推荐）

脚本 `backfill-verify.mjs`（node22，server 8801 / web 5291，PACMAN_HOME `/tmp/bf-1241-home`）：

1. 用 origin/main（`9b027a5c`，无 #1241）起 server，注册 3 台机器：两台留默认 3，一台 PATCH 成 5（`api-before-main.json`）。
2. 停 main；给 `bf-legacy-fingerprinted` 写入一份硬件指纹（12 核 / 36 GiB），模拟当前 daemon 已上报过一拍（main 不存 hardware）。
3. 用本分支在**同一库**上起 server：迁移 0043 + 启动回填 `backfillMachineConcurrency`（`api-after-branch-start1.json`、截图）。
4. 再重启一次：结果不变（`api-after-branch-start2.json`），幂等。

| 机器 | main 上 | 本分支启动后 |
|---|---|---|
| bf-legacy-fingerprinted（旧默认 3，有指纹） | 3 | **12**，推荐（measured） |
| bf-legacy-blank（旧默认 3，无指纹） | 3 | 3，估算 |
| bf-manual-5（手动 5） | 5 | 5，手动（不动） |

已知边界：在 main 上**手动设成恰好 3** 的机器与旧默认无法区分，按未覆盖处理（mon 已接受）。
