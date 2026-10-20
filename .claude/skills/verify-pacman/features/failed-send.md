# 失败面发送(详情页 composer failed 相位,#320/#322)

用户在失败任务的详情页 composer 输入反馈并发送 → 触发带反馈重启新一轮(非 steer 409 语义):`POST /api/builds/{id}/steps {action:"restart", feedback, clientMessageId}` → server 起新 build(withPlan 承接失败轮)+ 反馈行落新 conversation + 首步入队(instruction 携反馈)+ failed→queued 漏斗。原站实测:failed 态发消息 = 触发新一轮,消息随新轮入会话(r9 §3.3)。

## Sub-features

- `failed-composer-send` failed 相位详情页 composer 可输入 + 发送(非只读);发送钮走 restart 语义。
- `restart-action-wire` 发送 → `POST /api/builds/{id}/steps {action:"restart", feedback, clientMessageId}`(shared buildStepActionBodySchema 的 restart 变体)。
- `restart-new-build` server 起新 build(withPlan 承接失败轮)+ failed→queued 漏斗;反馈行落新 conversation。
- `restart-first-step` 首步入队,instruction 携用户反馈(revision 同缝)。
- `restart-phase-gate` restart 门只收 failed 相位(confirm 走 revision、building/review 走 steer——两写面相位隔离,不共享入口)。
- `restart-empty-rejected` 空消息不成发送(`feedback: z.string().min(1)`);异步 onSend 失败(409)时 draft 保留不丢字。

## Drive (vp.mjs)

- `vp.mjs drive failed-send restart-with-feedback`
- `vp.mjs drive failed-send restart-combo`

前置（stack / daemon / stub-llm …）、状态与脚本参数：`vp.mjs list failed-send`。`vp.mjs` = `node .claude/skills/verify-pacman/scripts/vp.mjs`。

## How to get to it (user POV)

- 失败任务详情页(`/app/todo/:id`,phase=failed)→ composer 输入反馈 → 发送钮。

## Driving it with verify-pacman

Preconditions:

1. `launch.mjs` 起隔离栈,`doctor.mjs` 全 PASS。
2. seed 一个 failed 相位的 todo(起 build → 让 plan/build 步失败,或直接构造 failed 态);live 面。
3. restart 起新 build 后,新轮执行需 daemon(可选——验证 restart 入队只需 server 面)。

- **跑法。** 造 failed 相位:launch → `setup-branch-sync-seed.mjs` 出一个待跑的 build(它留 pending 的 plan 步,git 现场对本功能无害) → 起真 daemon(`pnpm exec tsx src/cli.ts start --foreground --api-key <k> --team <teamId> --server http://127.0.0.1:<port>`)让它认领并跑挂该步(stub provider 不可达 → 步 failed → todo 落 failed) → **把 daemon 停干净**(见下方坑) → `node <skill>/scripts/drive-failed-send.mjs <todoId> <buildId>`。
- **失败面发送路径。** failed todo 详情页 → composer 填反馈文本 → 点发送 → 新 build 起(离开 failed)+ 反馈行入会话。
- **真值。** `POST /api/builds/{id}/steps {action:"restart",...}` 200;`GET /api/todos/{id}` 相位离开 failed——**具体值取决于有无机器认领**:`queued`(尚无认领)/`planning`(规划步已被 claim,`machines.ts` claim 处才推相位,`phase.ts` 注「机器 claim:规划步→planning」);新 build 行(prevPhase=failed + withPlan 承接)+ 新 conversation 含反馈 message(`message.content` 是 **JSON 列**,用户行 = JSON 字符串字面量,断言前要解码)+ 首步入队 prompt 携反馈;负向:非 failed 相位再发 restart → 409。
- **相位门负向。** 非 failed 相位调 restart → 409(`restart 仅适用于 failed 相位`)。

## Gotchas

- restart ≠ steer:steer 是运行中中断(building/review 相位,停止钮),restart 是失败后带反馈重启(failed 相位,composer 发送)——两写面相位隔离,server 漏斗边不同。
- 空 feedback 被 schema 拒(`z.string().min(1)`);异步 onSend 失败时 draft 保留(不丢用户输入)。
- restart 起的是**新 build**(withPlan 承接失败轮的 plan),不是原 build 续跑;todo.latestBuildId 指向新 build。
- 失败面 composer 在 fixture 静态面是只读占位;live 面才接 restart wire。
- **daemon 停不干净、还会「死前再认领一次」(实测)**:`TaskStop`/杀外层 shell 只给进程组发 SIGTERM,daemon(tsx)走**优雅收尾**——收尾窗口内它仍会受理已派发的 long-poll claim。实测时序:停止 → 点检通过 → probe 启动后 ~1.2s 步被认领(相位 failed→planning),之后再扫已无进程。所以 `machine.online=0` 与「服务端口无 ESTABLISHED」都是**时点快照**,抓不住这个窗口(claim 走长轮询、不走 machine stream,online 位不反映它)。两条应对:①**别指望停干净**——probe 已把相位断言放宽到「离开 failed」(queued/planning/building 都算过),这个 race 自然不致命;②真要确定它退出了,按 PID 判进程存活,别用 `pgrep -fl "tsx src/cli.ts start"`——真实命令行是 `.../tsx/dist/cli.mjs src/cli.ts start -f`,该 pattern 匹配不到,会给「已停」的假阴性。
- **composer 发送钮鼠标不可达(实测,非本功能缺陷)**:`.composer-send`(32×32)被 `.detail-fab`(48×48,总管悬浮钮,右下 16px 锚定)**完全覆盖**,`document.elementFromPoint` 在钮中心命中 fab → 真实 `click()` 超时(fixture 与 live 面皆如此)。仓内 `reject-chain.spec.ts` 与 `integration/test/m5-web-e2e.test.ts` 都因此用 `dispatchEvent('click')`。键盘 Enter 发送不受影响。本 probe 同样走 dispatchEvent 驱动 wire,并把遮挡事实量进 `result.json` 的 `sendReachableByMouse`/`sendCenterHit`。
- **验证状态(2026-09-28)**:主仓 live re-probe 已补——`drive-failed-send.mjs` 11 checks 全绿,证据归档 `docs/verify/320/`。
