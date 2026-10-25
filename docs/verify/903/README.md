# #903 派发判定 — live 验证证据（返工轮 / 第 2 轮）

The ruling canonical copy = `docs/adr/0014-chief-dispatch-verdict-authority-rests-with-chief-overridable.md` (rework round,
overturning round 1's ADR 0013 settings-slot scheme). Probe =
`.claude/skills/verify-pacman/scripts/drive-903-dispatch-judgment.mjs`，
2026-10-08 live **12/12 PASS**（隔离栈 8795/5277，全新库，零 daemon 零 LLM，
假机器走真 machine wire）。

第 1 轮证据（设置槽面：ChiefDispatchSelect 四截图 + PATCH 往返 + clamp 实证，
14/14 PASS）随设置槽被 ADR 0014 D1 删除而整体失效，已从本目录移除——按提交
`c16714b3` 可在 git 历史回查，其 raw 永久链（钉旧 SHA）仍可解析。

## 断言 → 文件对照

| 断言 | 裁决 | 实物 |
|---|---|---|
| S0 铺底（project + 三 todo） | — | `result.json` ids |
| U1 Agent tab 无「派发方式」行、邻座机器/压缩模型行健在 | D1（不留哑控件） | `01-settings-agent-no-dispatch-row.png` |
| A1 PATCH 单独 dispatchWithPlan → 400 | D1（槽死态） | `patch-reject-and-envelope.json` |
| A2 PATCH 混发 → 200 且键被剥离、封套无 dispatchWithPlan | D1（契约面死态） | 同上 |
| E1a systemPrompt 派发判定节：Mika 纪律原句 + 三信号 + 审阅关口恒在 + dispatchReason + 就地推翻只影响这一次；无 `withPlan:false` 写死指令、无设置合成残留 | D5/D3/D4 | `claim-e1.json`（判定节两行原文 + run_builds 定义） |
| E1b run_builds 词表：withPlan + dispatchReason 在位、必填仅 todoIds | D1/D4 | 同上 |
| E1c/E1d 缺省 → withPlan=true + reason null；build.withPlan=1 + 首步 plan | D2（fail-safe） | `relay-e1-default-plan.json` |
| E2a/E2b 显式 false + 理由 → 响应 false（无 clamp）+ 理由原样回显；build.withPlan=0 + 首步 build | D1/D4 | `relay-e2-direct-reason.json` |
| E3a/E3b 显式 true + 理由 → 回显；首步 plan | D1/D4 | `relay-e3-explicit-plan-reason.json` |

## 复跑配方

```sh
env -u http_proxy -u https_proxy -u all_proxy \
  VERIFY_REPO_ROOT=<worktree> VERIFY_PORT=8795 VERIFY_WEB_PORT=5277 \
  node .claude/skills/verify-pacman/scripts/launch.mjs
env -u http_proxy -u https_proxy -u all_proxy \
  VERIFY_REPO_ROOT=<worktree> \
  node .claude/skills/verify-pacman/scripts/drive-903-dispatch-judgment.mjs
```

撞端口先 `lsof -iTCP:8795 -sTCP:LISTEN` 查占用——占着的是别的车道就顺延端口，
别杀。依赖全新库：重验 = 重 launch（launch 会清运行目录）。
