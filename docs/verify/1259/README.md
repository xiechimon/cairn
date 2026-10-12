# #1259 agent 归属机绑定 live 验收证据

probe：`drive-1259-1260-binding.mjs`（verify-pacman 定制探针，与 #1260 共用一栈一
脚本；栈 = launch.mjs 隔离实例 server 8792 + web 5274 + 独立 PACMAN_HOME 全新库——
8791/5273 被别的 lane 占用，按端口纪律换口；零 daemon、零 LLM——派发面全走真
machine wire，UI 面走真浏览器）。结果：**27/27 checks PASS**（`result.json`）。

## 场景

双机各持各 api-key（`verify-home-1259` / `verify-other-1259`，enroll 时各带
claudeCode 模型清单报告：home 有 `stub-cc-model`，other 有 `stub-cc-other`）；
agent 出生绑归属机（创建必填，缺省 400）。

| 腿 | 动作 | 判据（证据文件） |
|---|---|---|
| A 路由 | 创建（machineId 必填）→ todo+build + chief 回合 → 别机/归属机 claim | `a-claims.json`：别机 75s 长轮询空手、归属机先后领到 build 步与 chief 步（kind + machineId） |
| C 换绑 | claude-code agent 换绑到缺模型的机器 → 400；合法换绑 → 新步即时改派 | result.json `C1`（400 文案含模型 id `stub-cc-model`）/ `C3`（原机空手）/ `C4`（新机领到） |
| D 生命周期 | 删有绑定的机器 → 409 点名；整机迁移（合格迁走、模型不合留机列原因）；腾空后删 204 | `d-evacuate.json`（evacuate 响应 + SQLite agent 行机器归属前后态） |
| E 存量兜底 | DB 直插无归属机存量 agent + 老化其 pending 步 → 调度拍扫 | `e-legacy-sweep.json`：步 failed + build.errorMessage 含「未设归属机」 |
| F UI 闭环 | machines 列表行机器名 → 详情页（fact 条 + 归属网格 + 预选归属机的创建弹窗） | `f1-machine-detail.png` / `f3-create-dialog.png` |

## 复跑配方

```sh
node .claude/skills/verify-pacman/scripts/launch.mjs          # 起隔离栈（全新库）
node .claude/skills/verify-pacman/scripts/drive-1259-1260-binding.mjs
node .claude/skills/verify-pacman/scripts/cleanup.mjs
```

## 单元 / e2e 面

- server：`test/agent-home-machine.test.ts`（8 例）+ `test/machine-exit.test.ts`
 （6 例）+ `test/machine-pin.test.ts` 归属机版重写 + 既有回归全绿。
- web：`e2e/team-create-agent.spec.ts` + `e2e/agent-create-model.spec.ts`（三级
 级联）+ `e2e/machine-detail.spec.ts`（4 例）+ `e2e/machines-local.spec.ts`
 （行链接收窄钉）；全量 e2e 891 绿。
