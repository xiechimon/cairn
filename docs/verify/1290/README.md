# #1290 verify evidence — claude 二进制探测 well-known 回落 + launchd PATH

两个问题面各自的实物：

## 1. 探测回落（`probe-narrow-path.json`）

复现命令（窄 PATH 模拟 launchd 环境，HOME 保留以解析 `~/.local/bin`）：

```sh
env -i HOME="$HOME" PATH=/usr/bin:/bin \
  /Users/xmon/.local/share/fnm/node-versions/v24.14.0/installation/bin/node \
  apps/daemon/node_modules/tsx/dist/cli.mjs /tmp/1290-probe-narrow-path.mts
```

实测输出要点：

- `probeWithFallback`：`PATH=/usr/bin:/bin` 下探到 `/opt/homebrew/bin/claude`
  （version 2.1.294），`source: "well-known"`——回落命中且来源点名。
- `probePathOnlyControl`（`wellKnownDirs: []`，即改动前的纯 PATH 行为）：
  同一窄 PATH 下 `null`——正是 issue 里 launchd 报的 `not found`。
- `probe-narrow-path-old-code.json`：同命令跑 origin/main 的
  `claude-code-bin.ts`（git show 抽出的旧版），窄 PATH 下探测返回
  `null`——旧代码在 launchd 环境下必丢 homebrew 装的 claude 的直接实物。

## 2. launchd 模板（`plist-render-lint.log`）

用 install.sh 的 sed 渲染管线把 `com.xiechimon.pacman-daemon.plist.template`
渲染到 /tmp 下的副本，渲染后 PATH 串含 `/opt/homebrew/bin:/usr/local/bin`
（@NODE_DIR@ 之后），`plutil -lint` 通过。

单测面：`apps/daemon/test/claude-code-bin.test.ts` 失败方式 10–13
（PATH 空 + well-known 有桩 → 探到且 source 点名；PATH 有 → 不走回落；
全空 → null；无执行位 → 跳过；绝对路径命令不走回落）。
