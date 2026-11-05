# Issue 1561

Base revision: `77e7da2b95b9dfa28569268ba3e415c4d5be101f`

```text
## 现状

`scripts/single-use-helper-gate.mjs` 的白名单要求 `declaration` 与被标记函数的整段源码逐字相等。改动碰到一个很大的既有函数的任意一行（例如 #1560 给 `runClaimedStep` 加了一个参数），闸就会标红，而白名单要放行就得把上千行函数体整段写进 JSON，之后函数每改一次都要重写。

实测：xiechimon/pacman#1560 的 `single-use-helper-gate` 红，原因是 `apps/daemon/src/runner.ts:472 runClaimedStep`。

## 要做

- 白名单改为按 `path` + `name` + `reason` 匹配，不再要求整段声明文本。
- 只在函数是本次 diff 新增的（声明行本身是新增行）时才标记；既有函数里改了几行不应触发「新增单次使用函数」。

## 失败方式

- 放宽后漏掉真正新增的单次使用函数：保留现有的新增函数负对照测试。
- 白名单条目被滥用：每条必须带 reason，且 name 必须在当前文件里存在，否则闸报错。

## 验收

- [ ] 给既有大函数加一个参数，闸不标红（用 #1560 的 runClaimedStep 改动做负对照）
- [ ] 新增一个只被调用一次的非导出函数，闸仍标红
- [ ] 白名单条目不再包含函数全文

关联 #1543。
```
