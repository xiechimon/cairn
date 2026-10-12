# #1250 验证证据（角色名册 + verify 步 + 三视角 fan-out + split_todo）

- 探针：`scripts/drive-1250-persona-verify.mjs`（本仓 `.claude/skills/verify-pacman/scripts/`）
- 判读：feature map `features/persona-verify.md`；实测坑 `changelog/2026-10-12-1250.md`
- 结果：**live 27/27 PASS**（`result.json` 的 checks 逐条 ok，零 FAIL）
- 栈坐标（本轮）：server `127.0.0.1:8795` / web `127.0.0.1:5277` / PACMAN_HOME
  `…/.claude/verify-run/home`（全新库，seed 用户 Owner）；零 daemon 零 LLM——
  假机器 wire（claim / tool relay / done）+ 浏览器真点击腿。

## 证据清单

| 文件 | 内容 |
|---|---|
| `result.json` | 27 条 checks 逐条 ok/label + 栈坐标 + ids |
| `seeding-personas.json` | S 相位：六员 persona 行（persona/契约名/档位/provider/modelId/tools） |
| `verify-step.json` | V 相位：verify 步行（pending + prompt 材料：证据目录/输出契约）|
| `verify-verdict-message.json` | V 相位：VERIFY_VERDICT 消息行（passed=false 有效结论 + 2 证据条目）|
| `fanout-steps.json` | F 相位：三条 review 步（prompt meta header 各挂 persona agentId）|
| `01-detail-verify-active.png` | 浏览器：verify 步 pending → 头带 chip「验证中」 |
| `02-detail-verify-verdict.png` | 浏览器：verdict 行「验证未通过」+ 证据条目 2 条 |
| `03-review-dialog-fanout.png` | 浏览器：AI 审核弹层出现「三视角并行审」行 |
| `04-detail-fanout-verdicts.png` | 浏览器：三份视角结论并行落会话 |
| `05-split-parent-confirm.png` | 浏览器：父卡停 confirm（拆解方案文档 + 拆解宣告行）|
| `06-split-parent-done.png` | 浏览器：全子卡 done → 父卡自动收 |

## 复跑配方

```sh
# 本 lane 端口对（撞占用顺延并同步改）：
lsof -nP -iTCP:8795 -sTCP:LISTEN; lsof -nP -iTCP:5277 -sTCP:LISTEN
cd <本 worktree>
env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  NO_PROXY=localhost,127.0.0.1 \
  VERIFY_PORT=8795 VERIFY_WEB_PORT=5277 \
  node .claude/skills/verify-pacman/scripts/cleanup.mjs   # 重 launch 前必先清
env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  NO_PROXY=localhost,127.0.0.1 \
  VERIFY_PORT=8795 VERIFY_WEB_PORT=5277 \
  node .claude/skills/verify-pacman/scripts/launch.mjs
env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  NO_PROXY=localhost,127.0.0.1 \
  node .claude/skills/verify-pacman/scripts/drive-1250-persona-verify.mjs
```

依赖全新库（重验 = 重 launch）。跑完 `node …/scripts/cleanup.mjs` 回收栈。

## 关联证据面

- fixture 面：`apps/web/e2e/persona-verify.spec.ts` 3/3（verdict 三态 + 证据
  条目 + 弹层 fan-out 行零渲染负向钉；全量 e2e 923/923 见 PR body）。
- unit：`apps/server/test/persona-split-verify.test.ts` 12/12、
  `apps/daemon/test/verify-verdict.test.ts` 6/6、
  `packages/shared/test/persona.test.ts` / `verify-prompt.test.ts` /
  `chief-tools.test.ts`（shared 351/351 全绿内含）。
