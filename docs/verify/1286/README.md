# #1286 recover 面会话降级验证

本页是 PR #1286 的机制验收实录。修的是 daemon 重启后 journal continue 必败
（pi 会话懒落盘窗口重启时 `.jsonl` 缺失 → `SessionNotResumableError` 直传步
failed）。

## 修法

`apps/daemon/src/runner.ts` 的 `openSession` 恢复 `SessionNotResumableError`
捕获，但收窄到 recover 面（`opts.resume` 在位）：
- recover 面 + `.jsonl` 缺失 → 降级 `createSession` 重发 journal.prompt（步成功）
- recover 面 + journal.prompt 为 null → 显式失败带可读文案（不静默空重发）
- 执行面（无 `opts.resume`）→ 直传步 failed（#1260 语义保留）

## 实证方式

机制类改动验收取实物（仓 AGENTS.md 硬纪律）：不靠读源码，靠运行真路径取
运行时证据。

### 证据一：单测（5 个失败方式先行固化）

`apps/daemon/test/runner-recover-degrade.test.ts`，每个失败方式一个测试，
其中 recover 面用「continueSession 抛 `SessionNotResumableError`」的 stub
backend 直接模拟 `.jsonl` 缺失，断言降级后步成功：

```
$ cd apps/daemon && npx vitest run test/runner-recover-degrade.test.ts

 ✓ test/runner-recover-degrade.test.ts (5 tests) 
   ✓ #1286 recover 面会话降级 (5)
     ✓ 1. recover + .jsonl 缺失 → 降级 new session，步成功（主 bug 修复）
     ✓ 2. recover + .jsonl 在 → 正常 continue，不触发降级
     ✓ 3. 非 recover（无 opts.resume）→ continue 失败直传步 failed（#1260 语义保留）
     ✓ 4. journal.prompt 为 null + .jsonl 缺失 → 显式失败带可读文案
     ✓ 5. chief 步 recover + .jsonl 缺失 → 降级 new session，同律
```

### 证据二：真 pi 后端缺会话文件演练（临时 PACMAN_HOME + 真 SessionNotResumableError）

单测用 stub 直接抛 `SessionNotResumableError`，但「recover 时 `.jsonl` 缺失」
这个真实触发条件是 pi 后端 `continueSession` 的 `existsSync(file)` 判出来的。
下面脚本用临时 `PACMAN_HOME` 造一个**有 journal 条目、有 index.json 条目、
但磁盘 `.jsonl` 不存在**的场景，跑 `PiBackend.continueSession`，断言它真的
抛 `SessionNotResumableError`（即修复前会直传 failed 的那个错），再断言
`SessionNotResumableError` 是 `Error` 的子类、`instanceof` 判定可用（runner
降级链依赖它）。

运行：`bash docs/verify/1286/recover-degrade.sh`

输出见 [output.log](./output.log)。
