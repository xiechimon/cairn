# #1628 重检查名额

- `demo-slots.sh` / `demo-slots.log`：名额 2、同时起 4 条的演示。用轻量替身命令（各跑 2 秒的 node 脚本）代替完整 prepush，因为机器负载已很高，不真起 4 条全量 prepush。A 段结果：4 条全部退出码 0，同一时刻最多 2 条在跑，另 2 条打印「排队中」后依次跑完。B 段：`kill -9` 持锁者后，排队者在 111 ms 内拿到名额（验收线 5 秒）。
- omarchy 上完整 prepush 加 `e2e:affected` 的峰值内存实测：待宿主。据此定 omarchy 的 `CAIRN_HEAVY_SLOTS`，初值 3。
